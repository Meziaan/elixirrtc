defmodule Hmconf.Room do
  @moduledoc false

  use GenServer

  require Logger

  alias Hmconf.{Conference, Peer, PeerSupervisor} # Added Conference alias
  alias HmconfWeb.PeerChannel

  @peer_ready_timeout_s 10
  @peer_limit 32

  def start_link(room_id) do
    GenServer.start_link(__MODULE__, room_id)
  end

  # Public API for adding a peer
  def add_peer(_room_id, channel_pid) do
    GenServer.call(__MODULE__, {:add_peer, channel_pid})
  end

  @impl true
  def init(room_id) do
    {:ok, _} = Registry.register(Hmconf.RoomRegistry, room_id, self())

    state = %{
      room_id: room_id,
      peers: %{},
      pending_peers: %{},
      peer_pid_to_id: %{},
      shared_video: nil,
      whiteboard_history: [],
      video_state: nil
    }

    {:ok, state}
  end

  @impl true
  def handle_call({:add_peer, _channel_pid}, _from, state)
      when map_size(state.pending_peers) + map_size(state.peers) == @peer_limit do
    Logger.warning("Unable to add new peer: reached peer limit (#{@peer_limit})")
    {:reply, {:error, :peer_limit_reached}, state}
  end

  @impl true
  def handle_call({:add_peer, channel_pid}, _from, state) do
    id = generate_id()
    Logger.info("New peer #{id} added to room #{state.room_id}")
    peer_ids = Map.keys(state.peers)

    # First, create the participant in the database
    room = Conference.get_room!(state.room_id) # Assuming room always exists at this point
    participant_attrs = %{joined_at: DateTime.utc_now()}

    case Conference.create_participant(room, participant_attrs) do
      {:ok, participant} ->
        case PeerSupervisor.add_peer(state.room_id, id, channel_pid, peer_ids) do
          {:ok, pid} ->
            Process.monitor(pid)

            peer_data = %{pid: pid, channel: channel_pid, participant: participant} # Store participant

            state =
              state
              |> put_in([:pending_peers, id], peer_data)
              |> put_in([:peer_pid_to_id, pid], id)

            Process.send_after(self(), {:peer_ready_timeout, id}, @peer_ready_timeout_s * 1000)

            reply = {:ok, id, state.shared_video, state.whiteboard_history, state.video_state}
            {:reply, reply, state}

          {:error, reason} ->
            Logger.error("Failed to add peer #{id} to room #{state.room_id}: #{inspect(reason)}")
            {:reply, {:error, :peer_start_failed}, state}
        end

      {:error, changeset} ->
        Logger.error("Failed to create participant for room #{state.room_id}: #{inspect(changeset.errors)}")
        {:reply, {:error, :participant_creation_failed}, state}
    end
  end

  @impl true
  def handle_call({:mark_ready, id}, _from, state)
      when is_map_key(state.pending_peers, id) do
    Logger.info("Peer #{id} ready")
    broadcast({:peer_added, id}, state)

    {peer_data, state} = pop_in(state, [:pending_peers, id])
    state = put_in(state, [:peers, id], peer_data)

    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:mark_ready, id}, _from, state) do
    Logger.debug("Peer #{id} was already marked as ready, ignoring")

    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:set_shared_video, video}, _from, state) do
    state =
      if video != nil and video.type == :whiteboard do
        %{state | shared_video: video, whiteboard_history: [], video_state: nil}
      else
        %{state | shared_video: video, video_state: nil}
      end

    {:reply, :ok, state}
  end

  @impl true
  def handle_call(:clear_shared_video, _from, state) do
    {:reply, :ok, %{state | shared_video: nil, whiteboard_history: [], video_state: nil}}
  end

  @impl true
  def handle_call(:get_shared_video, _from, state) do
    {:reply, state.shared_video, state}
  end

  @impl true
  def handle_call({:whiteboard_draw, data}, _from, state) do
    state = update_in(state, [:whiteboard_history], &(&1 ++ [data]))
    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:set_video_state, video_state}, _from, state) do
    {:reply, :ok, %{state | video_state: video_state}}
  end

  @impl true
  def handle_info({:peer_ready_timeout, peer}, state) do
    if is_map_key(state.pending_peers, peer) do
      Logger.warning(
        "Removing peer #{peer} which failed to mark itself as ready for #{@peer_ready_timeout_s} s"
      )

      :ok = PeerSupervisor.terminate_peer(peer)
    end

    {:noreply, state}
  end

  @impl true
  def handle_info({:DOWN, _ref, :process, pid, reason}, state) do
    {id, state} = pop_in(state, [:peer_pid_to_id, pid])
    Logger.info("Peer #{id} down with reason #{inspect(reason)}")

    state =
      cond do
        is_map_key(state.pending_peers, id) ->
          {peer_data, state} = pop_in(state, [:pending_peers, id])
          :ok = PeerChannel.close(peer_data.channel)

          state

        is_map_key(state.peers, id) ->
          {peer_data, state} = pop_in(state, [:peers, id])
          # Update participant's left_at timestamp
          if participant = Map.get(peer_data, :participant) do
            case Conference.leave_participant(participant) do
              {:ok, _} -> Logger.info("Participant #{participant.id} left room #{state.room_id}")
              {:error, changeset} -> Logger.error("Failed to update participant #{participant.id}: #{inspect(changeset.errors)}")
            end
          end
          :ok = PeerChannel.close(peer_data.channel)
          broadcast({:peer_removed, id}, state)

          state
      end

    if state.shared_video && state.shared_video.sharer_id == id do
      broadcast({:sharing_stopped, state.shared_video.type}, state)
      {:noreply, %{state | shared_video: nil, whiteboard_history: [], video_state: nil}}
    else
      {:noreply, state}
    end
  end

  defp generate_id, do: 5 |> :crypto.strong_rand_bytes() |> Base.encode16(case: :lower)

  defp broadcast(msg, state) do
    Map.keys(state.peers)
    |> Stream.concat(Map.keys(state.pending_peers))
    |> Enum.each(&Peer.notify(&1, msg))
  end
end
