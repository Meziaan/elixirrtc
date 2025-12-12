defmodule Nexus.Repo.Migrations.CreateRooms do
  use Ecto.Migration

  def change do
    create table(:rooms) do
      add :uuid, :string
      add :started_at, :utc_datetime
      add :ended_at, :utc_datetime

      timestamps()
    end
  end
end
