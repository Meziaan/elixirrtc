defmodule Hmconf.Repo.Migrations.CreateRooms do
  use Ecto.Migration

  def change do
    create table(:rooms, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :short_code, :string, null: false
      add :name, :string
      add :started_at, :utc_datetime
      add :ended_at, :utc_datetime

      timestamps()
    end

    create unique_index(:rooms, [:short_code])
  end
end