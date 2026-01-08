defmodule Hmconf.Repo.Migrations.AddSharedLinksTranscriptToRooms do
  use Ecto.Migration

  def change do
    alter table(:rooms) do
      add :shared_links_transcript, :map, default: %{}, null: false
    end
  end
end
