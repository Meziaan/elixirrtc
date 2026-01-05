defmodule Hmconf.Repo.Migrations.AddMessagesTranscriptToRooms do
  use Ecto.Migration

    def change do

      alter table(:rooms) do

        add :messages_transcript, :map, default: %{}, null: false

      end

    end
end
