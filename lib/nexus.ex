defmodule Nexus do
  @moduledoc """
  The Nexus context.
  """

  def generate_room_token(room_id) do
    # In a real application, this would be a more secure token generation
    # and management system, possibly involving JWTs or database storage.
    # For now, a simple random string will suffice.
    room_id <> ":" <> (5 |> :crypto.strong_rand_bytes() |> Base.encode16(case: :lower))
  end

  def validate_room_token(token) do
    case String.split(token, ":") do
      [room_id, _random_part] -> {:ok, room_id}
      _ -> :error
    end
  end
end