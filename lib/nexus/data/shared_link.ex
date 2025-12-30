defmodule Nexus.Data.SharedLink do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "shared_links" do
    field :url, :string
    belongs_to :room, Nexus.Data.Room
    belongs_to :participant, Nexus.Data.Participant

    timestamps()
  end

  @doc false
  def changeset(shared_link, attrs) do
    shared_link
    |> cast(attrs, [:url, :room_id, :participant_id])
    |> validate_required([:url, :room_id, :participant_id])
  end
end