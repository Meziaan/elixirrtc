defmodule Nexus.Room.Supervisor do
  @moduledoc false

  use DynamicSupervisor

  def start_link(init_arg) do
    DynamicSupervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  @impl true
  def init(_init_arg) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  def start_child(room_data) do
    spec = {Nexus.Room, room_data}
    DynamicSupervisor.start_child(__MODULE__, spec)
  end
end
