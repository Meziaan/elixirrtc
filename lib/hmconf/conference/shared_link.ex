defmodule Hmconf.Conference.SharedLink do
  @moduledoc """
  Schema for shared links in a conference room.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "shared_links" do
    field(:url, :string)
    field(:shared_at, :utc_datetime)

    belongs_to(:room, Hmconf.Conference.Room)
    belongs_to(:participant, Hmconf.Conference.Participant)

    timestamps()
  end

  @doc false
  def changeset(shared_link, attrs) do
    shared_link
    |> cast(attrs, [:url, :shared_at, :participant_id])
    |> validate_required([:url, :shared_at, :participant_id])
  end
end
