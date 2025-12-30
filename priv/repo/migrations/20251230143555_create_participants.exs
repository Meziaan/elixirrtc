defmodule Hmconf.Repo.Migrations.CreateParticipants do
  use Ecto.Migration

  def change do
    create table(:participants, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false
      add :room_id, references(:rooms, type: :binary_id, on_delete: :nothing), null: false
      add :joined_at, :naive_datetime, null: false
      add :left_at, :naive_datetime

      timestamps()
    end

    create index(:participants, [:room_id])
  end
end
