defmodule Hmconf.Conference.Participant do
  @moduledoc """
  Schema for participants in a conference room.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "room_participants" do
    field(:ip_address, :string)
    field(:joined_at, :utc_datetime)
    field(:left_at, :utc_datetime)

    belongs_to(:room, Hmconf.Conference.Room)

    timestamps()
  end

  @doc false
  def changeset(participant, attrs) do
    participant
    |> cast(attrs, [:ip_address, :joined_at, :left_at])
    |> validate_required([:ip_address, :joined_at])
  end
end
