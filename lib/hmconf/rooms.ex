defmodule Hmconf.Rooms do
  @moduledoc """
  Public API for interacting with Rooms.
  """

  def add_peer(room_id, channel_pid, name) do
    with {:ok, room_pid} <- find_or_start_room(room_id) do
      GenServer.call(room_pid, {:add_peer, channel_pid, name})
    end
  end

  def mark_ready(room_id, peer_id) do
    with {:ok, room_pid} <- find_or_start_room(room_id) do
      GenServer.call(room_pid, {:mark_ready, peer_id})
    end
  end

  def set_shared_video(room_id, video) do
    with {:ok, room_pid} <- find_or_start_room(room_id) do
      GenServer.call(room_pid, {:set_shared_video, video})
    end
  end

  def clear_shared_video(room_id) do
    with {:ok, room_pid} <- find_or_start_room(room_id) do
      GenServer.call(room_pid, :clear_shared_video)
    end
  end

  def get_shared_video(room_id) do
    with {:ok, room_pid} <- find_or_start_room(room_id) do
      GenServer.call(room_pid, :get_shared_video)
    end
  end

  def whiteboard_draw(room_id, data) do
    with {:ok, room_pid} <- find_or_start_room(room_id) do
      GenServer.call(room_pid, {:whiteboard_draw, data})
    end
  end

  def set_video_state(room_id, video_state) do
    with {:ok, room_pid} <- find_or_start_room(room_id) do
      GenServer.call(room_pid, {:set_video_state, video_state})
    end
  end

  defp find_or_start_room(room_id) do
    case Registry.lookup(Hmconf.RoomRegistry, room_id) do
      [{pid, _}] ->
        {:ok, pid}

      [] ->
        case Hmconf.Room.Supervisor.start_child(room_id) do
          {:ok, pid} -> {:ok, pid}
          {:ok, pid, _} -> {:ok, pid}
          error -> error
        end
    end
  end
end
