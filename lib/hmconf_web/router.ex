defmodule HmconfWeb.Router do
  use HmconfWeb, :router

  import Phoenix.LiveDashboard.Router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {HmconfWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :auth do
    plug :admin_auth
  end

  scope "/", HmconfWeb do
    pipe_through :browser

    get "/", PageController, :home
    get "/:room_id", PageController, :room
  end

  scope "/admin", HmconfWeb do
    pipe_through :auth
    pipe_through :browser

    live_dashboard "/dashboard",
      metrics: HmconfWeb.Telemetry,
      additional_pages: [exwebrtc: ExWebRTCDashboard]
  end

  defp admin_auth(conn, _opts) do
    username = Application.fetch_env!(:hmconf, :admin_username)
    password = Application.fetch_env!(:hmconf, :admin_password)
    Plug.BasicAuth.basic_auth(conn, username: username, password: password)
  end
end
