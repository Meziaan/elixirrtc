defmodule Nexus.Data.SharedLink do
  use Ecto.Schema
  import Ecto.Changeset

  schema "shared_links" do
    field :url, :string
    field :timestamp, :utc_datetime
    belongs_to :room, Nexus.Data.Room
    belongs_to :participant, Nexus.Data.Participant

    timestamps()
  end

  @doc false
  def changeset(shared_link, attrs) do
    shared_link
    |> cast(attrs, [:url, :timestamp])
    |> validate_required([:url, :timestamp])
  end
end
