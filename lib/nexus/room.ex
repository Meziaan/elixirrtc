defmodule Nexus.Room do
  @moduledoc false

  use GenServer

  require Logger

  alias Nexus.{Peer, PeerSupervisor}
  alias NexusWeb.PeerChannel

  @peer_ready_timeout_s 10
  @peer_limit 32

  def start_link(room_id) do
    GenServer.start_link(__MODULE__, room_id)
  end

  @impl true
  def init(room_id) do
    {:ok, _} = Registry.register(Nexus.RoomRegistry, room_id, self())

    state = %{
      room_id: room_id,
      peers: %{},
      pending_peers: %{},
      peer_pid_to_id: %{},
      shared_video: nil
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
    Logger.info("Adding new peer to room", room_id: state.room_id, peer_id: id)
    peer_ids = Map.keys(state.peers)

    {:ok, pid} = PeerSupervisor.add_peer(state.room_id, id, channel_pid, peer_ids)
    Process.monitor(pid)

    peer_data = %{pid: pid, channel: channel_pid}

    state =
      state
      |> put_in([:pending_peers, id], peer_data)
      |> put_in([:peer_pid_to_id, pid], id)

    Process.send_after(self(), {:peer_ready_timeout, id}, @peer_ready_timeout_s * 1000)

    {:reply, {:ok, id, state.shared_video}, state}
  end

  @impl true
  def handle_call({:mark_ready, id}, _from, state)
      when is_map_key(state.pending_peers, id) do
    Logger.info("Peer marked as ready", room_id: state.room_id, peer_id: id)
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
    {:reply, :ok, %{state | shared_video: video}}
  end

  @impl true
  def handle_call({:clear_shared_video, name}, _from, state) do
    if state.shared_video && state.shared_video.sender == name do
      {:reply, true, %{state | shared_video: nil}}
    else
      {:reply, false, state}
    end
  end

  @impl true
  def handle_info({:peer_ready_timeout, peer}, state) do
    if is_map_key(state.pending_peers, peer) do
      Logger.warning(
        "Removing peer which failed to mark itself as ready for #{@peer_ready_timeout_s} s",
        room_id: state.room_id,
        peer_id: peer
      )

      :ok = PeerSupervisor.terminate_peer(peer)
    end

    {:noreply, state}
  end

  @impl true
  def handle_info({:DOWN, _ref, :process, pid, reason}, state) do
    {id, state} = pop_in(state, [:peer_pid_to_id, pid])
    Logger.warning("Peer down", room_id: state.room_id, peer_id: id, reason: reason)

    state =
      cond do
        is_map_key(state.pending_peers, id) ->
          {peer_data, state} = pop_in(state, [:pending_peers, id])
          :ok = PeerChannel.close(peer_data.channel)

          state

        is_map_key(state.peers, id) ->
          {peer_data, state} = pop_in(state, [:peers, id])
          :ok = PeerChannel.close(peer_data.channel)
          broadcast({:peer_removed, id}, state)

          state
      end

    {:noreply, state}
  end

  defp generate_id, do: 5 |> :crypto.strong_rand_bytes() |> Base.encode16(case: :lower)

  defp broadcast(msg, state) do
    Map.keys(state.peers)
    |> Stream.concat(Map.keys(state.pending_peers))
    |> Enum.each(&Peer.notify(&1, msg))
  end
end
