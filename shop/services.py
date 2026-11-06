"""Проверка всех данных, которые приходят с сайта и из панели."""
import base64
import binascii
import io
import logging
import re
import secrets
import time
from datetime import timedelta

import pyotp
from django.conf import settings
from django.utils import timezone
from PIL import Image, ImageOps

from .models import Attempt, Category, Order, Product, TotpDevice

log = logging.getLogger('shop.security')

MAX_PRICE = 10_000_000
MAX_IMAGE_SIDE = 2000
STATUSES = ('new', 'confirmed', 'making', 'ready', 'done', 'canceled')
SOURCES = ('site', 'whatsapp', 'instagram', 'phone', 'shop')
IMG_RE = re.compile(r'/(static/shop/img(/site)?|media/uploads)/\w[\w.-]*')
Image.MAX_IMAGE_PIXELS = 40_000_000   # защита от «картинок-бомб»


class Bad(ValueError):
    """Ошибка, текст которой можно показать пользователю."""


def text(value, limit):
    return str(value or '').strip()[:limit]


def clean_img(value):
    img = text(value, 200)
    if img and not IMG_RE.fullmatch(img):
        raise Bad('Неверное фото')
    return img


def clean_price(value):
    try:
        price = int(value or 0)
    except (TypeError, ValueError):
        raise Bad('Неверная цена')
    if not 0 <= price <= MAX_PRICE:
        raise Bad('Неверная цена')
    return price


def clean_product(raw):
    try:
        category = Category.objects.get(slug=text(raw.get('cat'), 40))
    except Category.DoesNotExist:
        raise Bad('Неизвестная категория')
    name = text(raw.get('name'), 120)
    if not name:
        raise Bad('Нужно название')
    options = [{'label': text(o.get('label'), 40), 'price': clean_price(o.get('price'))}
               for o in (raw.get('options') or [])[:8]]
    if not options:
        raise Bad('Нужна хотя бы одна цена')
    return {'category': category, 'name': name, 'desc': text(raw.get('desc'), 500), 'img': clean_img(raw.get('img')),
            'options': options, 'hit': bool(raw.get('hit')), 'active': bool(raw.get('active', True))}


def instagram_name(value):
    # Принимаем и имя, и ссылку целиком: instagram.com/имя/?igsh=... → имя
    raw = text(value, 200)
    match = re.search(r'instagram\.com/([^/?#\s]+)', raw, re.I)
    name = (match[1] if match else raw).lstrip('@')
    if name and not re.fullmatch(r'[\w.]{1,30}', name):
        raise Bad('Неверная ссылка на Instagram')
    return name


def clean_shop(raw):
    whatsapp = re.sub(r'\D', '', str(raw.get('whatsapp', '')))
    if not 9 <= len(whatsapp) <= 15:
        raise Bad('Неверный номер WhatsApp')
    return {'name': text(raw.get('name'), 60) or 'Tulpan Flowers', 'whatsapp': whatsapp,
            'instagram': instagram_name(raw.get('instagram')), 'instagram2': instagram_name(raw.get('instagram2')),
            'hours': text(raw.get('hours'), 40),
            'addresses': [a for a in (text(x, 120) for x in (raw.get('addresses') or [])[:5]) if a]}


def clean_site(raw, current):
    cats = set(Category.objects.values_list('slug', flat=True))
    first = next(iter(sorted(cats)), '')

    def cat_of(item):
        cat = text(item.get('cat'), 40)
        return cat if cat in cats else first

    bouquets = []
    for b in (raw.get('bouquets') or [])[:12]:
        name = text(b.get('name'), 80)
        if not name:
            raise Bad('У каждого букета должно быть название')
        product = text(b.get('product'), 40)
        if product and not Product.objects.filter(pk=product).exists():
            raise Bad('Товар для букета не найден')
        bouquets.append({'name': name, 'desc': text(b.get('desc'), 160), 'img': clean_img(b.get('img')),
                         'price': clean_price(b.get('price')), 'cat': cat_of(b), 'product': product,
                         'opt': clean_price(b.get('opt'))})
    if not bouquets:
        raise Bad('Нужен хотя бы один букет')
    tiles = [{'title': text(t.get('title'), 60), 'text': text(t.get('text'), 160),
              'img': clean_img(t.get('img')), 'cat': cat_of(t)} for t in (raw.get('tiles') or [])[:2]]
    strip = [i for i in (clean_img(x) for x in (raw.get('strip') or [])[:5]) if i]
    return {'hero': clean_img(raw.get('hero')) or current.get('hero', ''), 'bouquets': bouquets,
            'tiles': tiles, 'strip': strip}


def bouquet_view(b):
    # Цена связанного букета всегда берётся из каталога; скрытый товар цену не показывает
    if not b.get('product'):
        return b
    product = Product.objects.filter(pk=b['product'], active=True).first()
    opt = b.get('opt', 0)
    if not product or opt >= len(product.options):
        return {**b, 'price': 0}
    return {**b, 'price': product.options[opt]['price'], 'cat': product.category_id}


def client_key(phone, name):
    digits = re.sub(r'\D', '', phone)
    if len(digits) == 10 and digits[0] == '0':   # 0700... → 996700...
        digits = '996' + digits[1:]
    elif len(digits) == 9:
        digits = '996' + digits
    if digits:
        return digits[:120]
    return ('n:' + name.lower())[:120] if name else ''


def contact(raw):
    return {'name': text(raw.get('name'), 80), 'phone': text(raw.get('phone'), 30), 'when': text(raw.get('when'), 80),
            'how': text(raw.get('how'), 160), 'addr': text(raw.get('addr'), 200), 'card': text(raw.get('card'), 300),
            'note': text(raw.get('note'), 500)}


def quantity(value):
    try:
        return min(max(int(value or 1), 1), 999)
    except (TypeError, ValueError):
        raise Bad('Неверное количество')


def items_from_site(raw):
    # Цены берём из каталога, а не из запроса: покупатель не может подменить сумму
    items = []
    for item in (raw.get('items') or [])[:30]:
        product = Product.objects.filter(pk=text(item.get('id'), 40), active=True).first()
        try:
            opt = int(item.get('opt', 0))
        except (TypeError, ValueError):
            continue
        if not product or not 0 <= opt < len(product.options):
            continue
        option = product.options[opt]
        items.append({'name': product.name, 'label': option['label'], 'q': quantity(item.get('q')), 'price': option['price']})
    if not items:
        raise Bad('Заказ пуст')
    return items


def clean_items(raw):
    items = []
    for item in (raw.get('items') or [])[:30]:
        name = text(item.get('name'), 160)
        if name:
            items.append({'name': name, 'label': text(item.get('label'), 40), 'q': quantity(item.get('q')),
                          'price': clean_price(item.get('price'))})
    if not items:
        raise Bad('Добавьте хотя бы одну позицию')
    return items


def clean_status(raw):
    status, source = text(raw.get('status'), 20), text(raw.get('source'), 20)
    if status not in STATUSES or source not in SOURCES:
        raise Bad('Неверный статус')
    return status, source


def save_order(order, fields, items, status, source, memo):
    for key, value in fields.items():
        setattr(order, key, value)
    order.status, order.source, order.memo, order.items = status, source, memo, items
    order.key = client_key(fields['phone'], fields['name'])
    order.total = sum(i['q'] * i['price'] for i in items)
    order.save()
    return order


def order_json(o):
    return {'id': o.pk, 'n': o.pk, 'ts': int(o.created.timestamp()), 'status': o.status, 'source': o.source,
            'name': o.name, 'phone': o.phone, 'when': o.when, 'how': o.how, 'addr': o.addr, 'card': o.card,
            'note': o.note, 'memo': o.memo, 'key': o.key, 'items': o.items, 'total': o.total}


def product_json(p):
    return {'id': p.pk, 'cat': p.category_id, 'name': p.name, 'desc': p.desc, 'img': p.img,
            'options': p.options, 'hit': p.hit, 'active': p.active}


def save_upload(body):
    """Фото пересобирается заново в JPEG: внутри файла не останется ни скриптов, ни данных о месте съёмки."""
    try:
        raw = base64.b64decode(str(body.get('data', '')).split(',')[-1], validate=True)
        image = Image.open(io.BytesIO(raw))
        if image.format not in ('JPEG', 'PNG', 'WEBP'):
            raise Bad('Нужно фото JPG, PNG или WebP')
        image = ImageOps.exif_transpose(image).convert('RGB')
    except (binascii.Error, OSError, ValueError, Image.DecompressionBombError) as error:
        if isinstance(error, Bad):
            raise
        raise Bad('Не получилось открыть фото')
    image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
    folder = settings.MEDIA_ROOT / 'uploads'
    folder.mkdir(parents=True, exist_ok=True)
    name = f'{secrets.token_hex(12)}.jpg'
    image.save(folder / name, 'JPEG', quality=85, optimize=True)
    return f'/media/uploads/{name}'


def client_ip(request):
    if settings.TRUST_PROXY:
        real = request.META.get('HTTP_X_REAL_IP', '').strip()
        if real:
            return real[:64]
    return request.META.get('REMOTE_ADDR', '')[:64]


def too_many(bucket, key, limit, seconds):
    since = timezone.now() - timedelta(seconds=seconds)
    return Attempt.objects.filter(bucket=bucket, key=key[:160], at__gte=since).count() >= limit


def note_attempt(bucket, key):
    Attempt.objects.create(bucket=bucket, key=key[:160])
    Attempt.objects.filter(at__lt=timezone.now() - timedelta(days=1)).delete()


def clear_attempts(bucket, key):
    Attempt.objects.filter(bucket=bucket, key=key[:160]).delete()


def totp_ok(user, code):
    device = TotpDevice.objects.filter(user=user).first()
    if not device:
        return not settings.REQUIRE_2FA
    code = re.sub(r'\D', '', code)
    if len(code) != 6:
        return False
    totp = pyotp.TOTP(device.secret)
    step = int(time.time()) // totp.interval
    for candidate in (step - 1, step, step + 1):
        if candidate > device.last_step and secrets.compare_digest(totp.at(candidate * totp.interval), code):
            device.last_step = candidate
            device.save(update_fields=['last_step'])
            return True
    return False


def new_order(fields, items, source, status='new', memo='', rid=None):
    return save_order(Order(rid=rid), fields, items, status, source, memo)
