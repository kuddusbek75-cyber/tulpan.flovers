# Tulpan Flowers: инструкция по выкладке

Сайт на Django 5.2 и Python 3.10+. Внутри один проект:

| Адрес | Что это |
|---|---|
| `/` | Информационный сайт |
| `/catalog/` | Каталог с корзиной, заказ уходит в WhatsApp и в CRM |
| `/секретный-адрес/` | Панель: заказы, клиенты, цены, фото, контакты |

В архиве **нет** паролей, ключей и базы данных. Всё это создаётся на сервере командами ниже.

## Вариант 1. PythonAnywhere (проще всего)

Нужен тариф, на котором можно подключить свой домен. Без домена сайт будет на `ЛОГИН.pythonanywhere.com`.

В разделе **Consoles → Bash**:

```bash
unzip tulpan-flowers-django.zip
cd tulpan-django
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python init_env.py ЛОГИН.pythonanywhere.com
python manage.py migrate
python manage.py load_shop
python manage.py collectstatic --noinput
python manage.py createsuperuser
python manage.py setup_2fa ЛОГИН_ИЗ_CREATESUPERUSER
```

Если `python3.13` нет, возьмите самую новую версию из доступных, но не ниже 3.10.

Команда `init_env.py` покажет **адрес панели**, а `setup_2fa` покажет **ключ** для приложения с кодами. Сохраните оба, они показываются один раз.

Затем в разделе **Web**:

1. Add a new web app → Manual configuration → та же версия Python.
2. Virtualenv: `/home/ЛОГИН/tulpan-django/.venv`
3. Source code: `/home/ЛОГИН/tulpan-django`
4. Откройте WSGI configuration file и замените всё содержимое на:
   ```python
   import os, sys
   sys.path.insert(0, '/home/ЛОГИН/tulpan-django')
   os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings'
   from django.core.wsgi import get_wsgi_application
   application = get_wsgi_application()
   ```
5. Static files: URL `/static/`, папка `/home/ЛОГИН/tulpan-django/staticfiles`
6. Security: включите **Force HTTPS**.
7. Нажмите **Reload**.

## Вариант 2. Свой сервер Ubuntu

```bash
sudo apt update && sudo apt install -y python3-venv nginx certbot python3-certbot-nginx unzip
sudo mkdir -p /var/www && sudo unzip tulpan-flowers-django.zip -d /var/www
sudo chown -R www-data:www-data /var/www/tulpan-django
cd /var/www/tulpan-django
sudo -u www-data python3 -m venv .venv
sudo -u www-data .venv/bin/pip install -r requirements.txt
sudo -u www-data .venv/bin/python init_env.py ВАШ-ДОМЕН www.ВАШ-ДОМЕН
sudo -u www-data .venv/bin/python manage.py migrate
sudo -u www-data .venv/bin/python manage.py load_shop
sudo -u www-data .venv/bin/python manage.py collectstatic --noinput
sudo -u www-data .venv/bin/python manage.py createsuperuser
sudo -u www-data .venv/bin/python manage.py setup_2fa ЛОГИН
sudo cp deploy/tulpan.service /etc/systemd/system/
sudo systemctl enable --now tulpan
sudo sed 's/ВАШ-ДОМЕН/настоящий-домен/g' deploy/nginx.conf | sudo tee /etc/nginx/sites-available/tulpan
sudo ln -s /etc/nginx/sites-available/tulpan /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d настоящий-домен -d www.настоящий-домен
```

Закройте лишние порты: наружу должны смотреть только 22, 80 и 443.

## Проверка после выкладки

```bash
python manage.py check --deploy
python manage.py test
```

Обе команды запускаются из папки проекта с включённым `.venv`. Первая не должна выдавать ошибок, а вторая должна закончиться строкой `OK`.

Откройте в браузере и проверьте:

- `/` и `/catalog/` открываются, в адресной строке https;
- `/admin/` показывает ошибку 404, так и задумано;
- секретный адрес открывает страницу входа;
- тестовый заказ из корзины появился в панели, после проверки удалите его.

## Как зайти в панель

Откройте `https://ВАШ-ДОМЕН/секретный-адрес/` и введите логин, пароль и 6 цифр из приложения Google Authenticator. После пяти ошибок вход с этого адреса блокируется на 15 минут.

Если потерян телефон с кодами или забыт пароль:

```bash
python manage.py setup_2fa ЛОГИН
python manage.py changepassword ЛОГИН
```

Если адрес панели утёк, поменяйте значение `ADMIN_PATH` в файле `.env` (только маленькие латинские буквы, цифры и дефис, от 16 символов) и перезапустите сайт.

## Копии данных

Всё важное лежит в двух местах: `db.sqlite3` (товары, заказы, клиенты) и папка `media/` (загруженные фото). Копируйте их раз в день **за пределы сервера**. Файл `.env` храните отдельно: без него старые сессии перестанут работать, а адрес панели будет потерян.

```bash
python manage.py dumpdata --exclude contenttypes --exclude sessions --exclude shop.attempt > backup.json
```

Раз в месяц обновляйте зависимости: `pip install -U -r requirements.txt`, затем `python manage.py test` и перезапуск сайта.

## Что нельзя делать

- Не ставьте `DEBUG=1` на сервере: сайт начнёт показывать внутренние данные при ошибках.
- Не выкладывайте `.env` и `db.sqlite3` в GitHub и не пересылайте их в мессенджерах. В базе имена и телефоны клиентов.
- Не меняйте `TRUST_PROXY=1`, если сайт стоит за nginx или PythonAnywhere. Если сервер смотрит в интернет напрямую, поставьте `TRUST_PROXY=0`.
