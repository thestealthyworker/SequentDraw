using System;
using Npgsql;
using StackExchange.Redis;

namespace Processor
{
    public class Program
    {
        public static void Main()
        {
            var redis = ConnectionMultiplexer.Connect("redis").GetDatabase();
            var pgsql = new NpgsqlConnection("Server=db;Username=postgres;Password=postgres;");
            pgsql.Open();

            // A keep-alive ping, not a read of the data: it names no table.
            var keepAlive = pgsql.CreateCommand();
            keepAlive.CommandText = "SELECT 1";

            while (true)
            {
                string json = redis.ListLeftPopAsync("votes").Result;
                if (json == null)
                {
                    keepAlive.ExecuteNonQuery();
                    continue;
                }

                var command = pgsql.CreateCommand();
                command.CommandText = "INSERT INTO votes (id, choice) VALUES (@id, @choice)";
                command.ExecuteNonQuery();
            }
        }
    }
}
