defmodule Hmconf.Repo.Migrations.CreateRoomMessages do
  use Ecto.Migration

  def change do
    create table(:room_messages, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :sender_ip, :string
      add :content, :string
      add :sent_at, :utc_datetime
      add :room_id, references(:rooms, on_delete: :delete_all, type: :binary_id), null: false

      timestamps()
    end

    create index(:room_messages, [:room_id])
  end
end