CSP = '; '.join([
    "default-src 'self'",
    "script-src 'self'",                                    # никаких встроенных скриптов: это главная защита от XSS
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",                           # blob и data нужны для сжатия фото в панели
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])


class SecurityHeaders:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault('Content-Security-Policy', CSP)
        response.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        return response
