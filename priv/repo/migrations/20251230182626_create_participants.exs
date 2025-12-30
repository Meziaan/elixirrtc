defmodule Nexus.Repo.Migrations.CreateParticipants do
  use Ecto.Migration

  def change do
    create table(:participants, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string
      add :joined_at, :utc_datetime
      add :left_at, :utc_datetime
      add :room_id, references(:rooms, on_delete: :delete_all, type: :binary_id)

      timestamps()
    end
  end
end