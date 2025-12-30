defmodule Hmconf.Room.Supervisor do
  @moduledoc false

  use DynamicSupervisor

  def start_link(init_arg) do
    DynamicSupervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  @impl true
  def init(_init_arg) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  def start_child(room_id) do
    spec = {Hmconf.Room, room_id}
    DynamicSupervisor.start_child(__MODULE__, spec)
  end
end
