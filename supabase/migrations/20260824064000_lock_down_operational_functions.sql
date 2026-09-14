revoke execute on function public.consume_webhook_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_webhook_rate_limit(text, integer, integer)
  to service_role;

revoke execute on function public.purge_expired_operational_data(integer, integer)
  from public, anon, authenticated;
grant execute on function public.purge_expired_operational_data(integer, integer)
  to service_role;

revoke execute on function public.set_job_failed_at()
  from public, anon, authenticated;

revoke all on table public.webhook_rate_limits
  from public, anon, authenticated;
