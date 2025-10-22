defmodule Nexus.RoomTest do
  use ExUnit.Case, async: true

  alias Nexus.Room

  setup do
    room_id = "test-room-" <> Integer.to_string(System.unique_integer())
    {:ok, room_pid} = Room.start_link(room_id)
    %{room_pid: room_pid}
  end

  test "should handle 4 peers joining a room", %{room_pid: room_pid} do
    # Simulate 4 peers joining. In the real app, the channel process is the client.
    # In this test, we can use the test process itself as a stand-in for the channel.
    client1 = self()
    client2 = self()
    client3 = self()
    client4 = self()

    # Add the peers to the room
    {:ok, peer1_id, _} = GenServer.call(room_pid, {:add_peer, client1})
    {:ok, peer2_id, _} = GenServer.call(room_pid, {:add_peer, client2})
    {:ok, peer3_id, _} = GenServer.call(room_pid, {:add_peer, client3})
    {:ok, peer4_id, _} = GenServer.call(room_pid, {:add_peer, client4})

    # Mark all peers as ready
    :ok = GenServer.call(room_pid, {:mark_ready, peer1_id})
    :ok = GenServer.call(room_pid, {:mark_ready, peer2_id})
    :ok = GenServer.call(room_pid, {:mark_ready, peer3_id})
    :ok = GenServer.call(room_pid, {:mark_ready, peer4_id})

    # Get the final state of the room
    state = :sys.get_state(room_pid)

    # Assert that all 4 peers are in the room's state and are no longer pending
    assert map_size(state.peers) == 4
    assert map_size(state.pending_peers) == 0

    # Assert that we have peer data for all 4 peers that we added
    assert Map.has_key?(state.peers, peer1_id)
    assert Map.has_key?(state.peers, peer2_id)
    assert Map.has_key?(state.peers, peer3_id)
    assert Map.has_key?(state.peers, peer4_id)
  end
end
