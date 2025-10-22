defmodule NexusWeb.IceServersController do
  use NexusWeb, :controller

  @doc """
  Provides ICE server configuration to clients, including STUN and TURN servers.

  In a production environment, the TURN server credentials should be temporary and generated on-demand
  to ensure security. For this application, we are reading them from the environment configuration.
  Ensure that your TURN server credentials are kept secure and are not exposed publicly.
  """
  def index(conn, _params) do
    # Fetch the configured list of ICE servers from the application environment.
    # This is expected to be configured in `config/prod.exs` or `config/runtime.exs`.
    ice_servers = Application.fetch_env!(:nexus, :ice_servers)
    json(conn, %{iceServers: ice_servers})
  end
end
