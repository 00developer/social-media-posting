# Built from this folder by docker-compose.yml's supabase-proxy service. The config is baked in with COPY
# rather than bind-mounted, because a relative bind mount of a single file isn't reliable on Coolify.
FROM nginx:1.27-alpine
COPY default.conf.template /etc/nginx/templates/default.conf.template
