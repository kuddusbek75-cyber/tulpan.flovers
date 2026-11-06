from django.conf import settings
from django.db import models


class Category(models.Model):
    slug = models.SlugField(primary_key=True, max_length=40)
    name = models.CharField(max_length=60)
    position = models.IntegerField(default=0)

    class Meta:
        ordering = ['position']


class Product(models.Model):
    id = models.CharField(primary_key=True, max_length=40)
    category = models.ForeignKey(Category, on_delete=models.PROTECT)
    name = models.CharField(max_length=120)
    desc = models.TextField(blank=True, max_length=500)
    img = models.CharField(blank=True, max_length=200)
    options = models.JSONField(default=list)   # [{"label": "25 шт", "price": 2500}]
    hit = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    position = models.IntegerField(default=0)

    class Meta:
        ordering = ['position']


class Shop(models.Model):
    """Одна запись: контакты магазина."""
    name = models.CharField(max_length=60, default='Tulpan Flowers')
    whatsapp = models.CharField(max_length=15)
    instagram = models.CharField(max_length=30, blank=True)
    instagram2 = models.CharField(max_length=30, blank=True)
    hours = models.CharField(max_length=40, blank=True)
    addresses = models.JSONField(default=list)


class SiteContent(models.Model):
    """Одна запись: букеты, плитки и фото инфо-сайта."""
    data = models.JSONField(default=dict)


class Order(models.Model):
    created = models.DateTimeField(auto_now_add=True, db_index=True)
    status = models.CharField(max_length=20, default='new', db_index=True)
    source = models.CharField(max_length=20, default='site')
    name = models.CharField(max_length=80, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    when = models.CharField(max_length=80, blank=True)
    how = models.CharField(max_length=160, blank=True)
    addr = models.CharField(max_length=200, blank=True)
    card = models.CharField(max_length=300, blank=True)
    note = models.CharField(max_length=500, blank=True)
    memo = models.CharField(max_length=500, blank=True)
    key = models.CharField(max_length=120, blank=True, db_index=True)
    items = models.JSONField(default=list)
    total = models.BigIntegerField(default=0)
    rid = models.CharField(max_length=40, null=True, blank=True, unique=True)

    class Meta:
        ordering = ['-id']


class ClientNote(models.Model):
    key = models.CharField(primary_key=True, max_length=120)
    note = models.CharField(max_length=500, blank=True)


class Attempt(models.Model):
    """Счётчик попыток входа и заказов. Хранится в базе, поэтому общий для всех процессов сервера."""
    bucket = models.CharField(max_length=20)
    key = models.CharField(max_length=160)
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['bucket', 'key', 'at'])]


class TotpDevice(models.Model):
    """Секрет кода из приложения (Google Authenticator и подобных)."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    secret = models.CharField(max_length=64)
    last_step = models.BigIntegerField(default=0)   # один и тот же код нельзя использовать дважды
