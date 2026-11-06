from django.urls import path

from . import views

urlpatterns = [
    path('', views.panel, name='panel'),
    path('login/', views.panel_login, name='panel_login'),
    path('logout/', views.panel_logout, name='panel_logout'),
    path('api/data', views.data),
    path('api/crm', views.crm),
    path('api/shop', views.update_shop),
    path('api/site', views.update_site),
    path('api/upload', views.upload),
    path('api/products', views.products),
    path('api/products/<str:pk>', views.product_detail),
    path('api/orders', views.orders),
    path('api/orders/<int:pk>', views.order_detail),
    path('api/client', views.client),
]
