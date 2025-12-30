defmodule Nexus.Rooms do
  @moduledoc """
  Public API for interacting with Rooms.
  """

  alias Nexus.Repo
  alias Nexus.Data.Room, as: RoomData

  def add_peer(room_name, channel_pid) do
    with {:ok, room_pid, _room} <- find_or_start_room(room_name) do
      GenServer.call(room_pid, {:add_peer, channel_pid})
    end
  end

  def mark_ready(room_name, peer_id) do
    with {:ok, room_pid, _room} <- find_or_start_room(room_name) do
      GenServer.call(room_pid, {:mark_ready, peer_id})
    end
  end

  def set_shared_video(room_name, video) do
    with {:ok, room_pid, _room} <- find_or_start_room(room_name) do
      GenServer.call(room_pid, {:set_shared_video, video})
    end
  end

  def clear_shared_video(room_name) do
    with {:ok, room_pid, _room} <- find_or_start_room(room_name) do
      GenServer.call(room_pid, :clear_shared_video)
    end
  end

  def get_shared_video(room_name) do
    with {:ok, room_pid, _room} <- find_or_start_room(room_name) do
      GenServer.call(room_pid, :get_shared_video)
    end
  end

  def whiteboard_draw(room_name, data) do
    with {:ok, room_pid, _room} <- find_or_start_room(room_name) do
      GenServer.call(room_pid, {:whiteboard_draw, data})
    end
  end

  def set_video_state(room_name, video_state) do
    with {:ok, room_pid, _room} <- find_or_start_room(room_name) do
      GenServer.call(room_pid, {:set_video_state, video_state})
    end
  end

  def find_or_start_room(room_name) do
    room =
      case Repo.get_by(RoomData, name: room_name) do
        nil ->
          changeset = RoomData.changeset(%RoomData{}, %{name: room_name})
          {:ok, new_room} = Repo.insert(changeset)
          new_room

        existing_room ->
          existing_room
      end

    case Registry.lookup(Nexus.RoomRegistry, room.id) do
      [{pid, _}] ->
        {:ok, pid, room}

      [] ->
        case Nexus.Room.Supervisor.start_child(room) do
          {:ok, pid} -> {:ok, pid, room}
          {:ok, pid, _} -> {:ok, pid, room}
          error -> error
        end
    end
  end
end