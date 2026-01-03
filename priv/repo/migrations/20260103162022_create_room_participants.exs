defmodule Hmconf.Repo.Migrations.CreateRoomParticipants do
  use Ecto.Migration

  def change do
    create table(:room_participants, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :ip_address, :string
      add :joined_at, :utc_datetime
      add :left_at, :utc_datetime
      add :room_id, references(:rooms, on_delete: :delete_all, type: :binary_id), null: false

      timestamps()
    end

    create index(:room_participants, [:room_id])
  end
end