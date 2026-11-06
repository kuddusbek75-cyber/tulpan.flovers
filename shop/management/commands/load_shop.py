import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from shop.models import Category, Product, Shop, SiteContent

SEED = Path(__file__).resolve().parents[2] / 'seed'


def fix_img(path):
    return f'/static/shop/{path}' if path.startswith('img/') else path


class Command(BaseCommand):
    help = 'Загружает товары и содержимое сайта в пустую базу'

    @transaction.atomic
    def handle(self, *args, **options):
        if Product.objects.exists() or Shop.objects.exists():
            raise CommandError('В базе уже есть данные, загрузка отменена, чтобы их не затереть.')
        data = json.loads((SEED / 'products.json').read_text(encoding='utf-8'))
        site = json.loads((SEED / 'site.json').read_text(encoding='utf-8'))
        shop = data['shop']
        Shop.objects.create(name=shop['name'], whatsapp=shop['whatsapp'], instagram=shop['instagram'],
                            instagram2=shop.get('instagram2', ''), hours=shop['hours'], addresses=shop['addresses'])
        for i, c in enumerate(data['categories']):
            Category.objects.create(slug=c['id'], name=c['name'], position=i)
        for i, p in enumerate(data['products']):
            Product.objects.create(id=p['id'], category_id=p['cat'], name=p['name'], desc=p['desc'], img=fix_img(p['img']),
                                   options=p['options'], hit=p['hit'], active=p['active'], position=i)
        site['hero'] = fix_img(site['hero'])
        site['strip'] = [fix_img(x) for x in site['strip']]
        for item in site['bouquets'] + site['tiles']:
            item['img'] = fix_img(item['img'])
        SiteContent.objects.create(data=site)
        self.stdout.write(self.style.SUCCESS(f'Загружено товаров: {len(data["products"])}'))
