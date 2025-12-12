defmodule Nexus.Repo.Migrations.CreateParticipants do
  use Ecto.Migration

  def change do
    create table(:participants) do
      add :name, :string
      add :joined_at, :utc_datetime
      add :left_at, :utc_datetime
      add :room_id, references(:rooms, on_delete: :delete_all)

      timestamps()
    end
  end
end
