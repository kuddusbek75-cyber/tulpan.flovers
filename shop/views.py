import json
import secrets
from functools import wraps

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.exceptions import RequestDataTooBig
from django.db import IntegrityError, transaction
from django.db.models import Min
from django.http import HttpResponse, HttpResponseNotAllowed, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.debug import sensitive_post_parameters
from django.views.decorators.http import require_GET, require_POST

from . import services as s
from .models import Category, ClientNote, Order, Product, Shop, SiteContent

MAX_ORDER_BODY = 20 * 1024


def shop_json():
    shop = Shop.objects.first()
    return {'name': shop.name, 'whatsapp': shop.whatsapp, 'instagram': shop.instagram,
            'instagram2': shop.instagram2, 'hours': shop.hours, 'addresses': shop.addresses}


def site_data():
    return SiteContent.objects.first().data


def categories_json():
    return [{'id': c.slug, 'name': c.name} for c in Category.objects.all()]


def read_json(request):
    try:
        body = json.loads(request.body or b'{}')
    except (ValueError, UnicodeDecodeError, RequestDataTooBig):
        raise s.Bad('Неверные данные')
    if not isinstance(body, dict):
        raise s.Bad('Неверные данные')
    return body


def error(message, status=400):
    return JsonResponse({'error': message}, status=status)


# Публичные страницы

@require_GET
@ensure_csrf_cookie
def info_page(request):
    return render(request, 'shop/info.html')


@require_GET
@ensure_csrf_cookie
def catalog_page(request):
    return render(request, 'shop/catalog.html')


@require_GET
def robots(request):
    # Адрес панели здесь не указываем: этот файл читают и боты-взломщики
    return HttpResponse('User-agent: *\nAllow: /\n', content_type='text/plain')


@require_GET
def api_products(request):
    return JsonResponse({'shop': shop_json(), 'categories': categories_json(),
                         'products': [s.product_json(p) for p in Product.objects.filter(active=True)]})


@require_GET
def api_site(request):
    data = site_data()
    return JsonResponse({'shop': shop_json(), 'site': {**data, 'bouquets': [s.bouquet_view(b) for b in data['bouquets']]}})


@require_POST
def api_order(request):
    ip = s.client_ip(request)
    if s.too_many('order', ip, 8, 600) or s.too_many('order-all', 'all', 300, 3600):
        return error('Слишком много заказов, попробуйте позже', 429)
    if int(request.META.get('CONTENT_LENGTH') or 0) > MAX_ORDER_BODY:
        return error('Слишком большой запрос', 413)
    try:
        body = read_json(request)
        rid = s.text(body.get('rid'), 40) or None
        if rid and Order.objects.filter(rid=rid).exists():
            return JsonResponse({'ok': True})
        items = s.items_from_site(body)
        s.note_attempt('order', ip)
        s.note_attempt('order-all', 'all')
        with transaction.atomic():
            s.new_order(s.contact(body), items, 'site', rid=rid)
    except s.Bad as e:
        return error(str(e))
    except IntegrityError:   # два одинаковых запроса пришли одновременно
        pass
    return JsonResponse({'ok': True})


# Вход в панель

@sensitive_post_parameters('password', 'code')
@never_cache
def panel_login(request):
    if request.user.is_authenticated and request.user.is_staff:
        return redirect('panel')
    message, status = '', 200
    if request.method == 'POST':
        ip = s.client_ip(request)
        username = s.text(request.POST.get('username'), 150).lower()
        if s.too_many('login-ip', ip, 5, 900) or s.too_many('login-user', username, 10, 900):
            s.log.warning('Вход заблокирован: ip=%s', ip)
            return render(request, 'shop/login.html', {'message': 'Слишком много попыток. Подождите 15 минут.'}, status=429)
        user = None
        if not request.POST.get('website'):   # это поле скрыто от людей, его заполняют только боты
            user = authenticate(request, username=request.POST.get('username', ''), password=request.POST.get('password', ''))
        if user and user.is_staff and s.totp_ok(user, request.POST.get('code', '')):
            login(request, user)
            s.clear_attempts('login-ip', ip)
            s.clear_attempts('login-user', username)
            s.log.info('Вход в панель: %s, ip=%s', user.get_username(), ip)
            return redirect('panel')
        s.note_attempt('login-ip', ip)
        s.note_attempt('login-user', username)
        s.log.warning('Неудачный вход: ip=%s', ip)
        message, status = 'Неверный логин, пароль или код', 403
    return render(request, 'shop/login.html', {'message': message}, status=status)


@require_POST
def panel_logout(request):
    logout(request)
    return redirect('panel_login')


@never_cache
@ensure_csrf_cookie
def panel(request):
    if not (request.user.is_authenticated and request.user.is_staff):
        return redirect('panel_login')
    return render(request, 'shop/panel.html')


# API панели

def panel_api(*methods):
    """Каждый запрос проверяется заново: нужен вошедший сотрудник. CSRF проверяет Django."""
    def wrap(view):
        @wraps(view)
        @never_cache
        def inner(request, *args, **kwargs):
            if not (request.user.is_authenticated and request.user.is_staff):
                return error('Нужно войти', 401)
            if request.method not in methods:
                return HttpResponseNotAllowed(methods)
            try:
                return view(request, *args, **kwargs)
            except s.Bad as e:
                return error(str(e))
        return inner
    return wrap


@panel_api('GET')
def data(request):
    return JsonResponse({'shop': shop_json(), 'categories': categories_json(), 'site': site_data(), 'infoUrl': '/',
                         'products': [s.product_json(p) for p in Product.objects.all()]})


@panel_api('GET')
def crm(request):
    return JsonResponse({'orders': [s.order_json(o) for o in Order.objects.all()],
                         'clients': {c.key: {'note': c.note} for c in ClientNote.objects.all()}})


@panel_api('PUT')
def update_shop(request):
    fields = s.clean_shop(read_json(request))
    shop = Shop.objects.first()
    for key, value in fields.items():
        setattr(shop, key, value)
    shop.save()
    return JsonResponse(shop_json())


@panel_api('PUT')
def update_site(request):
    content = SiteContent.objects.first()
    content.data = s.clean_site(read_json(request), content.data)
    content.save()
    return JsonResponse(content.data)


@panel_api('POST')
def upload(request):
    return JsonResponse({'img': s.save_upload(read_json(request))})


@panel_api('POST')
def products(request):
    fields = s.clean_product(read_json(request))
    top = Product.objects.aggregate(m=Min('position'))['m'] or 0
    product = Product.objects.create(id='p' + secrets.token_hex(8), position=top - 1, **fields)
    return JsonResponse(s.product_json(product))


@panel_api('PUT', 'DELETE')
def product_detail(request, pk):
    product = get_object_or_404(Product, pk=pk)
    if request.method == 'DELETE':
        product.delete()
        return JsonResponse({'ok': True})
    for key, value in s.clean_product(read_json(request)).items():
        setattr(product, key, value)
    product.save()
    return JsonResponse(s.product_json(product))


def save_panel_order(order, raw):
    status, source = s.clean_status(raw)
    return s.save_order(order, s.contact(raw), s.clean_items(raw), status, source, s.text(raw.get('memo'), 500))


@panel_api('POST')
def orders(request):
    return JsonResponse(s.order_json(save_panel_order(Order(), read_json(request))))


@panel_api('PUT', 'DELETE')
def order_detail(request, pk):
    order = get_object_or_404(Order, pk=pk)
    if request.method == 'DELETE':
        order.delete()
        return JsonResponse({'ok': True})
    return JsonResponse(s.order_json(save_panel_order(order, read_json(request))))


@panel_api('PUT')
def client(request):
    raw = read_json(request)
    key = s.text(raw.get('key'), 120)
    if not key:
        raise s.Bad('Неизвестный клиент')
    ClientNote.objects.update_or_create(key=key, defaults={'note': s.text(raw.get('note'), 500)})
    return JsonResponse({'ok': True})
