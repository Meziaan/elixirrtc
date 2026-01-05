defmodule Hmconf.Conference.Room do
  @moduledoc """
  Schema for rooms in a conference system.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "rooms" do
    field(:short_code, :string)
    field(:name, :string)
    field(:started_at, :utc_datetime)
    field(:ended_at, :utc_datetime)
    field :messages_transcript, :map, default: %{}

    has_many(:participants, Hmconf.Conference.Participant)
    has_many(:room_messages, Hmconf.Conference.RoomMessage)
    has_many(:shared_links, Hmconf.Conference.SharedLink)

    timestamps()
  end

  @doc false
  def changeset(room, attrs) do
    room
    |> cast(attrs, [:short_code, :name, :started_at, :ended_at, :messages_transcript])
    |> validate_required([:short_code, :name])
  end
end
