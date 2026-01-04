defmodule Hmconf.Conference.Participant do
  @moduledoc """
  Schema for participants in a conference room.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "room_participants" do
    field(:joined_at, :utc_datetime)
    field(:left_at, :utc_datetime)

    belongs_to(:room, Hmconf.Conference.Room)

    timestamps()
  end

  @doc false
  def changeset(participant, attrs) do
    participant
    |> cast(attrs, [:joined_at, :left_at])
    |> validate_required([:joined_at])
  end
end
