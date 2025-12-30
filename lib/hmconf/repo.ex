defmodule Hmconf.Repo do
  use Ecto.Repo,
    otp_app: :hmconf,
    adapter: Ecto.Adapters.Postgres
end
