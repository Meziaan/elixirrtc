defmodule Hmconf.Conference do
  @moduledoc """
The Conference context provides functions for managing rooms, participants, and chat messages.
  """

  import Ecto.Query, warn: false
  alias Hmconf.Repo

  alias Ecto.Multi
  alias Hmconf.Conference.Participant
  alias Hmconf.Conference.Room
  alias Hmconf.Conference.RoomMessage
  alias Hmconf.Conference.SharedLink

  @doc """
  Returns the list of rooms.
  """
  def list_rooms do
    Repo.all(Room)
  end

  @doc """
  Gets a single room by id or short_code.

  Raises `Ecto.NoResultsError` if the Room does not exist.
  """
  def get_room!(id_or_short_code) do
    case Ecto.UUID.cast(id_or_short_code) do
      :error ->
        Repo.get_by!(Room, short_code: id_or_short_code)

      {:ok, uuid} ->
        Repo.get!(Room, uuid)
    end
  end

  @doc """
  Gets a single room by id or short_code.

  Returns `{:ok, room}` or `{:error, :not_found}`.
  """
  def get_room(id_or_short_code) do
    room = 
      case Ecto.UUID.cast(id_or_short_code) do
        :error ->
          Repo.get_by(Room, short_code: id_or_short_code)

        {:ok, uuid} ->
          Repo.get(Room, uuid)
      end

    case room do
      nil -> {:error, :not_found}
      _ -> {:ok, room}
    end
  end

  @doc """
  Gets a single room by id or short_code, creating it if it doesn't exist.
  """
  def find_or_create_room!(id_or_short_code) do
    case get_room(id_or_short_code) do
      {:error, :not_found} ->
        # if the id_or_short_code already contains the last 4 digits of a UUID, we don't want to add it again
        if String.length(id_or_short_code) > 4 and
             Regex.match?(~r/-[0-9a-f]{4}$/, id_or_short_code) do
          # It's possible the user is trying to access a room that was created, but then the DB was wiped.
          # In this case, we just create the room with the given short_code
          case create_room(%{
                 short_code: id_or_short_code,
                 name: id_or_short_code,
                 started_at: DateTime.utc_now()
               }) do
            {:ok, room} ->
              room

            {:error, changeset} ->
              raise "Could not create room: #{inspect(changeset)}"
          end
        else
          new_id = Ecto.UUID.generate()
          short_code_suffix = String.slice(new_id, -4, 4)
          new_short_code = "#{id_or_short_code}-#{short_code_suffix}"

          case create_room(%{
                 id: new_id,
                 short_code: new_short_code,
                 name: id_or_short_code,
                 started_at: DateTime.utc_now()
               }) do
            {:ok, room} ->
              room

            {:error, changeset} ->
              raise "Could not create room: #{inspect(changeset)}"
          end
        end

      {:ok, room} ->
        room
    end
  end

  def create_room!(name) do
    new_id = Ecto.UUID.generate()
    short_code_suffix = String.slice(new_id, -4, 4)
    new_short_code = "#{name}-#{short_code_suffix}"

    case create_room(%{
           id: new_id,
           short_code: new_short_code,
           name: name,
           started_at: DateTime.utc_now()
         }) do
      {:ok, room} ->
        room

      {:error, changeset} ->
        raise "Could not create room: #{inspect(changeset)}"
    end
  end


  @doc """
  Gets a single room with all its participants, messages and shared links.

  Raises `Ecto.NoResultsError` if the Room does not exist.
  """
  def get_room_with_details!(id_or_short_code) do
    room = get_room!(id_or_short_code)
    Repo.preload(room, [:participants, :room_messages, :shared_links])
  end

  @doc """
  Creates a room.
  """
  def create_room(attrs \\ %{}) do
    %Room{}
    |> Room.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Updates a room.
  """
  def update_room(%Room{} = room, attrs) do
    room
    |> Room.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a room.
  """
  def delete_room(%Room{} = room) do
    Repo.delete(room)
  end

  @doc """
  Returns an `%Ecto.Changeset{}` for tracking room changes.
  """
  def change_room(%Room{} = room, attrs \\ %{}) do
    Room.changeset(room, attrs)
  end

  @doc """
  Sets the `ended_at` timestamp for a room.
  """
  def end_room(%Room{} = room) do
    room
    |> change_room(%{ended_at: DateTime.utc_now()})
    |> Repo.update()
  end

  @doc """
  Returns the list of participants for a given room.
  """
  def list_participants(%Room{} = room) do
    Repo.all(from(p in Participant, where: p.room_id == ^room.id))
  end

  @doc """
  Gets a single participant.

  Raises `Ecto.NoResultsError` if the Participant does not exist.
  """
  def get_participant!(id), do: Repo.get!(Participant, id)

  @doc """
  Creates a participant for a given room.
  """
  def create_participant(%Room{} = room, attrs \\ %{}) do
    Multi.new()
    |> Multi.insert(:participant, Participant.changeset(%Participant{room_id: room.id}, attrs))
    |> Repo.transaction()
    |> case do
      {:ok, %{participant: participant}} -> {:ok, participant}
      {:error, _, changeset, _} -> {:error, changeset}
    end
  end

  @doc """
  Updates a participant.
  """
  def update_participant(%Participant{} = participant, attrs) do
    participant
    |> Participant.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a participant.
  """
  def delete_participant(%Participant{} = participant) do
    Repo.delete(participant)
  end

  @doc """
  Returns an `%Ecto.Changeset{}` for tracking participant changes.
  """
  def change_participant(%Participant{} = participant, attrs \\ %{}) do
    Participant.changeset(participant, attrs)
  end

  @doc """
  Sets the `left_at` timestamp for a participant.
  """
  def leave_participant(%Participant{} = participant) do
    participant
    |> change_participant(%{left_at: DateTime.utc_now()})
    |> Repo.update()
  end

  @doc """
  Returns the list of room_messages for a given room.
  """
  def list_messages(%Room{} = room) do
    Repo.all(from(m in RoomMessage, where: m.room_id == ^room.id, order_by: [asc: :sent_at]))
  end

  @doc """
  Gets a single room_message.

  Raises `Ecto.NoResultsError` if the RoomMessage does not exist.
  """
  def get_room_message!(id), do: Repo.get!(RoomMessage, id)

  @doc """
  Creates a room_message for a given room.
  """
  def create_message(%Room{} = room, attrs \\ %{}) do
    Multi.new()
    |> Multi.insert(
      :room_message,
      RoomMessage.changeset(%RoomMessage{room_id: room.id}, attrs)
    )
    |> Repo.transaction()
    |> case do
      {:ok, %{room_message: room_message}} -> {:ok, room_message}
      {:error, _, changeset, _} -> {:error, changeset}
    end
  end

  @doc """
  Updates a room_message.
  """
  def update_room_message(%RoomMessage{} = room_message, attrs) do
    room_message
    |> RoomMessage.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a room_message.
  """
  def delete_room_message(%RoomMessage{} = room_message) do
    Repo.delete(room_message)
  end

  @doc """
  Returns an `%Ecto.Changeset{}` for tracking room_message changes.
  """
  def change_room_message(%RoomMessage{} = room_message, attrs \\ %{}) do
    RoomMessage.changeset(room_message, attrs)
  end

  @doc """
  Returns the list of shared_links for a given room.
  """
  def list_shared_links(%Room{} = room) do
    Repo.all(from(l in SharedLink, where: l.room_id == ^room.id, order_by: [asc: :shared_at]))
  end

  @doc """
  Creates a shared_link for a given room.
  """
  def create_shared_link(%Room{} = room, attrs \\ %{}) do
    Multi.new()
    |> Multi.insert(:shared_link, SharedLink.changeset(%SharedLink{room_id: room.id}, attrs))
    |> Repo.transaction()
    |> case do
      {:ok, %{shared_link: shared_link}} -> {:ok, shared_link}
      {:error, _, changeset, _} -> {:error, changeset}
    end
  end
end