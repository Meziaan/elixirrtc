defmodule Hmconf.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @version Mix.Project.config()[:version]

  @spec version() :: String.t()
  def version(), do: @version

  @impl true
  def start(_type, _args) do
    children = [
      HmconfWeb.Telemetry,
      {DNSCluster, query: Application.get_env(:hmconf, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Hmconf.PubSub},
      # Start a worker by calling: Hmconf.Worker.start_link(arg)
      # {Hmconf.Worker, arg},
      # Start to serve requests, typically the last entry
      HmconfWeb.Endpoint,
      HmconfWeb.Presence,
      Hmconf.PeerSupervisor,
      {Registry, name: Hmconf.PeerRegistry, keys: :unique},
      {Registry, name: Hmconf.RoomRegistry, keys: :unique},
      Hmconf.Room.Supervisor
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Hmconf.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    HmconfWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
