from django.conf import settings
from django.urls import include, path, re_path
from django.views.static import serve

from shop import views

urlpatterns = [
    path('', views.info_page, name='info'),
    path('catalog/', views.catalog_page, name='catalog'),
    path('robots.txt', views.robots),
    path('api/products', views.api_products),
    path('api/site', views.api_site),
    path('api/orders', views.api_order),
    # Только файлы вида имя.jpg из папки загрузок, без просмотра каталога
    re_path(r'^media/uploads/(?P<path>\w[\w-]*\.jpg)$', serve, {'document_root': settings.MEDIA_ROOT / 'uploads'}),
    path(f'{settings.ADMIN_PATH}/', include('shop.panel_urls')),
]
