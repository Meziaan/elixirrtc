defmodule Nexus.Rooms do
  @moduledoc """
  Public API for interacting with Rooms.
  """

  alias Nexus.Room

  def add_peer(room_id, channel_pid) do
    with {:ok, room_pid} <- find_or_start_room(room_id) do
      GenServer.call(room_pid, {:add_peer, channel_pid})
    end
  end

  def mark_ready(room_id, peer_id) do
    with {:ok, room_pid} <- find_or_start_room(room_id) do
      GenServer.call(room_pid, {:mark_ready, peer_id})
    end
  end

  defp find_or_start_room(room_id) do
    case Registry.lookup(Nexus.RoomRegistry, room_id) do
      [{pid, _}] ->
        {:ok, pid}

      [] ->
        Nexus.Room.Supervisor.start_child(room_id)
    end
  end
end
