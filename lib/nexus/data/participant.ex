defmodule Nexus.Data.Participant do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "participants" do
    field :name, :string
    field :joined_at, :utc_datetime
    field :left_at, :utc_datetime
    belongs_to :room, Nexus.Data.Room

    timestamps()
  end

  @doc false
  def changeset(participant, attrs) do
    participant
    |> cast(attrs, [:name, :joined_at, :left_at, :room_id])
    |> validate_required([:name, :joined_at, :room_id])
  end
end