defmodule NexusWeb.HealthController do
  use NexusWeb, :controller

  def index(conn, _params) do
    send_resp(conn, 200, "OK")
  end
end
