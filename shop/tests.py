"""Проверки безопасности. Запуск: python manage.py test"""
import base64
import io
import json
import shutil
import tempfile
from pathlib import Path

import pyotp
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import Client, TestCase, override_settings
from PIL import Image

from . import services
from .models import Attempt, Order, Product, TotpDevice

PANEL = f'/{settings.ADMIN_PATH}/'
LOGIN = PANEL + 'login/'
API_ENDPOINTS = [
    ('get', 'api/data'), ('get', 'api/crm'), ('put', 'api/shop'), ('put', 'api/site'), ('post', 'api/upload'),
    ('post', 'api/products'), ('put', 'api/products/b-red-25'), ('delete', 'api/products/b-red-25'),
    ('post', 'api/orders'), ('put', 'api/orders/1'), ('delete', 'api/orders/1'), ('put', 'api/client'),
]


def jpeg_data():
    buffer = io.BytesIO()
    Image.new('RGB', (50, 50), 'red').save(buffer, 'JPEG')
    return 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()


class Base(TestCase):
    PASSWORD = 'корректная-лошадь-скрепка-7'

    @classmethod
    def setUpTestData(cls):
        call_command('load_shop', verbosity=0)
        User = get_user_model()
        cls.staff = User.objects.create_user('owner', password=cls.PASSWORD, is_staff=True)
        cls.plain = User.objects.create_user('buyer', password=cls.PASSWORD)
        cls.device = TotpDevice.objects.create(user=cls.staff, secret=pyotp.random_base32())

    def code(self):
        return pyotp.TOTP(self.device.secret).now()

    def sign_in(self, client=None):
        client = client or self.client
        response = client.post(LOGIN, {'username': 'owner', 'password': self.PASSWORD, 'code': self.code()})
        self.assertEqual(response.status_code, 302)
        return client

    def send(self, method, path, body=None):
        if method == 'get':
            return self.client.get(PANEL + path)
        return getattr(self.client, method)(PANEL + path, data=json.dumps(body or {}), content_type='application/json')


@override_settings(SECURE_SSL_REDIRECT=False)
class PanelIsClosed(Base):
    def test_standard_admin_addresses_do_not_exist(self):
        for path in ('/admin/', '/admin', '/admin/login/', '/wp-admin/', '/panel/', '/login/', '/manage/'):
            self.assertEqual(self.client.get(path).status_code, 404, path)

    def test_address_is_not_published(self):
        for path in ('/', '/catalog/', '/robots.txt'):
            self.assertNotIn(settings.ADMIN_PATH.encode(), self.client.get(path).content, path)
        for script in (Path(settings.BASE_DIR) / 'shop' / 'static' / 'shop' / 'js').glob('*.js'):
            self.assertNotIn(settings.ADMIN_PATH, script.read_text(encoding='utf-8'), script.name)

    def test_every_api_needs_login(self):
        for method, path in API_ENDPOINTS:
            self.assertEqual(self.send(method, path).status_code, 401, path)
        self.assertTrue(Product.objects.filter(pk='b-red-25').exists())

    def test_regular_user_gets_nothing(self):
        self.client.force_login(self.plain)
        for method, path in API_ENDPOINTS:
            self.assertEqual(self.send(method, path).status_code, 401, path)
        self.assertEqual(self.client.get(PANEL).status_code, 302)

    def test_panel_page_redirects_to_login(self):
        response = self.client.get(PANEL)
        self.assertEqual(response.status_code, 302)
        self.assertIn('login', response['Location'])

    def test_password_without_code_is_rejected(self):
        response = self.client.post(LOGIN, {'username': 'owner', 'password': self.PASSWORD, 'code': ''})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.send('get', 'api/data').status_code, 401)

    def test_code_cannot_be_used_twice(self):
        code = self.code()
        self.assertEqual(self.client.post(LOGIN, {'username': 'owner', 'password': self.PASSWORD, 'code': code}).status_code, 302)
        other = Client()
        self.assertEqual(other.post(LOGIN, {'username': 'owner', 'password': self.PASSWORD, 'code': code}).status_code, 403)

    def test_user_without_2fa_cannot_enter_when_required(self):
        get_user_model().objects.create_user('no2fa', password=self.PASSWORD, is_staff=True)
        with self.settings(REQUIRE_2FA=True):
            response = self.client.post(LOGIN, {'username': 'no2fa', 'password': self.PASSWORD, 'code': '123456'})
        self.assertEqual(response.status_code, 403)

    def test_login_is_locked_after_five_wrong_passwords(self):
        for _ in range(5):
            self.assertEqual(self.client.post(LOGIN, {'username': 'owner', 'password': 'wrong'}).status_code, 403)
        right = {'username': 'owner', 'password': self.PASSWORD, 'code': self.code()}
        self.assertEqual(self.client.post(LOGIN, right).status_code, 429)   # даже верный пароль не проходит

    def test_guessing_one_account_from_many_addresses_is_locked(self):
        for i in range(10):
            ip = f'10.0.0.{i}'
            self.assertEqual(self.client.post(LOGIN, {'username': 'owner', 'password': 'x'}, REMOTE_ADDR=ip).status_code, 403)
        self.assertEqual(self.client.post(LOGIN, {'username': 'owner', 'password': 'x'}, REMOTE_ADDR='10.0.1.1').status_code, 429)

    def test_bot_trap_field(self):
        data = {'username': 'owner', 'password': self.PASSWORD, 'code': self.code(), 'website': 'http://spam'}
        self.assertEqual(self.client.post(LOGIN, data).status_code, 403)

    def test_login_needs_csrf(self):
        strict = Client(enforce_csrf_checks=True)
        self.assertEqual(strict.post(LOGIN, {'username': 'owner', 'password': 'x'}).status_code, 403)
        self.assertEqual(Attempt.objects.count(), 0)

    def test_panel_changes_need_csrf_even_when_logged_in(self):
        strict = Client(enforce_csrf_checks=True)
        strict.force_login(self.staff)
        response = strict.delete(PANEL + 'api/products/b-red-25')
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Product.objects.filter(pk='b-red-25').exists())

    def test_logout_ends_session(self):
        self.sign_in()
        self.assertEqual(self.send('get', 'api/data').status_code, 200)
        self.client.post(PANEL + 'logout/')
        self.assertEqual(self.send('get', 'api/data').status_code, 401)


@override_settings(SECURE_SSL_REDIRECT=False)
class PublicOrders(Base):
    def order(self, **body):
        body.setdefault('items', [{'id': 'b-red-25', 'opt': 0, 'q': 2}])
        return self.client.post('/api/orders', data=json.dumps(body), content_type='application/json')

    def test_price_cannot_be_forged(self):
        self.assertEqual(self.order(items=[{'id': 'b-red-25', 'opt': 0, 'q': 2, 'price': 1}], total=1).status_code, 200)
        self.assertEqual(Order.objects.get().total, 6000)

    def test_buyer_cannot_set_status_or_memo(self):
        self.order(status='done', memo='x', source='shop')
        order = Order.objects.get()
        self.assertEqual((order.status, order.memo, order.source), ('new', '', 'site'))

    def test_same_order_is_saved_once(self):
        self.order(rid='abc')
        self.order(rid='abc')
        self.assertEqual(Order.objects.count(), 1)

    def test_spam_is_limited(self):
        statuses = [self.order().status_code for _ in range(10)]
        self.assertEqual(statuses[:8], [200] * 8)
        self.assertEqual(statuses[8:], [429, 429])

    def test_hidden_product_cannot_be_ordered(self):
        Product.objects.filter(pk='b-red-25').update(active=False)
        self.assertEqual(self.order().status_code, 400)

    def test_order_data_is_not_public(self):
        self.order(name='Секретное имя', phone='0700111222')
        for path in ('/api/products', '/api/site', '/'):
            self.assertNotIn('Секретное'.encode(), self.client.get(path).content)
        self.assertNotIn('Секретное имя', json.dumps(self.client.get('/api/products').json(), ensure_ascii=False))

    def test_bad_json(self):
        response = self.client.post('/api/orders', data='{нет', content_type='application/json')
        self.assertEqual(response.status_code, 400)


@override_settings(SECURE_SSL_REDIRECT=False)
class Uploads(Base):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.override = self.settings(MEDIA_ROOT=self.tmp)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.sign_in()

    def upload(self, raw):
        return self.send('post', 'api/upload', {'data': base64.b64encode(raw).decode()})

    def test_photo_is_saved_as_jpeg(self):
        response = self.send('post', 'api/upload', {'data': jpeg_data()})
        self.assertEqual(response.status_code, 200)
        self.assertRegex(response.json()['img'], r'^/media/uploads/[0-9a-f]{24}\.jpg$')

    def test_not_a_photo_is_rejected(self):
        for raw in (b'<svg onload=alert(1)>', b'<?php system($_GET[0]);', b'<html><script>alert(1)</script>', b'\xff\xd8\xff not jpeg'):
            self.assertEqual(self.upload(raw).status_code, 400, raw)
        self.assertEqual(list(self.tmp.rglob('*.*')), [])

    def test_script_hidden_in_photo_does_not_survive(self):
        buffer = io.BytesIO()
        Image.new('RGB', (50, 50), 'red').save(buffer, 'JPEG')
        response = self.upload(buffer.getvalue() + b'<script>alert(1)</script>')
        self.assertEqual(response.status_code, 200)
        saved = next(self.tmp.rglob('*.jpg')).read_bytes()
        self.assertNotIn(b'<script>', saved)

    def test_foreign_image_path_is_rejected(self):
        product = self.client.get(PANEL + 'api/data').json()['products'][0]
        for bad in ('https://evil.example/x.jpg', '/media/../db.sqlite3', 'javascript:alert(1)', '/static/shop/img/"><script>'):
            response = self.send('put', f'api/products/{product["id"]}', {**product, 'img': bad})
            self.assertEqual(response.status_code, 400, bad)

    def test_only_uploaded_files_are_served_from_media(self):
        for path in ('/media/uploads/../../db.sqlite3', '/media/uploads/%2e%2e/%2e%2e/.env', '/media/', '/media/uploads/', '/.env', '/db.sqlite3'):
            self.assertEqual(self.client.get(path).status_code, 404, path)


@override_settings(SECURE_SSL_REDIRECT=False)
class Pages(Base):
    def test_security_headers(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['X-Frame-Options'], 'DENY')
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
        self.assertIn("script-src 'self'", response['Content-Security-Policy'])
        self.assertNotIn('unsafe-eval', response['Content-Security-Policy'])

    def test_pages_have_no_inline_scripts(self):
        self.sign_in()
        for path in ('/', '/catalog/', PANEL):
            html = self.client.get(path).content.decode()
            self.assertNotIn('<script>', html, path)
            self.assertNotRegex(html, r'\son(click|load|error)=', path)

    def test_bouquet_price_follows_catalog(self):
        prices = [b['price'] for b in self.client.get('/api/site').json()['site']['bouquets']]
        self.assertEqual(prices, [3000, 6500, 5500])

    def test_seed_images_exist(self):
        root = Path(settings.BASE_DIR) / 'shop'
        for product in Product.objects.exclude(img=''):
            self.assertTrue((root / product.img.lstrip('/')).exists(), product.img)

    def test_phone_keys(self):
        self.assertEqual(services.client_key('0700 111 222', ''), '996700111222')
        self.assertEqual(services.client_key('+996 700 111 222', ''), '996700111222')
        self.assertEqual(services.client_key('', 'Айгерим'), 'n:айгерим')
