"""Создаёт файл .env со случайными секретами. Запускается один раз на сервере:

    python init_env.py tulpan.kg www.tulpan.kg

Секреты создаются на сервере и не лежат в архиве с кодом.
"""
import secrets
import sys
from pathlib import Path

ENV = Path(__file__).resolve().parent / '.env'


def main():
    hosts = sys.argv[1:]
    if not hosts:
        sys.exit('Укажите адрес сайта: python init_env.py tulpan.kg www.tulpan.kg')
    if ENV.exists():
        sys.exit('.env уже есть. Удалите его вручную, только если точно хотите новые секреты.')
    admin_path = 'panel-' + secrets.token_urlsafe(18).replace('_', '').replace('-', '').lower()
    ENV.write_text(
        f'SECRET_KEY={secrets.token_urlsafe(64)}\n'
        f'ADMIN_PATH={admin_path}\n'
        f'ALLOWED_HOSTS={",".join(hosts)}\n'
        'DEBUG=0\n'
        'REQUIRE_2FA=1\n'
        'TRUST_PROXY=1\n',
        encoding='utf-8',
    )
    try:
        ENV.chmod(0o600)
    except OSError:
        pass
    print('Готово, создан файл .env')
    print(f'Адрес панели: https://{hosts[0]}/{admin_path}/')
    print('Сохраните этот адрес в менеджере паролей и не публикуйте его.')


if __name__ == '__main__':
    main()
