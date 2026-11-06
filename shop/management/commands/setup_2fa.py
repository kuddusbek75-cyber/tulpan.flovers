import pyotp
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from shop.models import TotpDevice


class Command(BaseCommand):
    help = 'Включает код из приложения для сотрудника. Повторный запуск выдаёт новый ключ.'

    def add_arguments(self, parser):
        parser.add_argument('username')

    def handle(self, *args, **options):
        user = get_user_model().objects.filter(username=options['username']).first()
        if not user:
            raise CommandError('Нет такого пользователя')
        secret = pyotp.random_base32()
        TotpDevice.objects.update_or_create(user=user, defaults={'secret': secret, 'last_step': 0})
        self.stdout.write('Добавьте ключ в Google Authenticator: «+» → «Ввести ключ настройки».')
        self.stdout.write(f'Ключ: {secret}')
        self.stdout.write('Ключ показан один раз. Не отправляйте его в мессенджерах.')
