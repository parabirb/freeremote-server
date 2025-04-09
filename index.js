import ngrok from "ngrok";
import audify from "audify";
import xmlrpc from "xmlrpc";
import * as ft8 from "ft8js";
import config from "./config.js";
import { Server } from "socket.io";
import { JSONFilePreset } from "lowdb/node";
import { SlashCommandBuilder } from "@discordjs/builders";
import {
    readKey,
    readPrivateKey,
    readCleartextMessage,
    createCleartextMessage,
    sign,
    verify,
} from "openpgp";
import {
    REST,
    Routes,
    Client,
    AttachmentBuilder,
    GatewayIntentBits,
} from "discord.js";

// get the db
const db = await JSONFilePreset("database.json", { users: [] });

// read the pgp keys
const publicKey = await readKey({ armoredKey: config.publicKey });
const privateKey = await readPrivateKey({ armoredKey: config.privateKey });

// state
let state = {
    transmitting: false,
};

// xmlrpc clients
const flrigClient = xmlrpc.createClient({
    host: "127.0.0.1",
    port: config.flrigPort,
});
const fldigiClient = xmlrpc.createClient({
    host: "127.0.0.1",
    port: config.fldigiPort,
});

// shutdown function
async function shutdown() {
    console.log("Shutting down...");
}

// promisify callback
function asyncRpc(client, method, params = []) {
    return new Promise((resolve) => {
        client.methodCall(method, params, (err, val) => {
            if (err) throw err;
            resolve(val);
        });
    });
}

// discord client
const discordClient = new Client({
    intents: [GatewayIntentBits.Guilds],
});

const addUserCommand = new SlashCommandBuilder()
    .setName("adduser")
    .setDescription("Add a user to the whitelist.")
    .addUserOption((option) =>
        option
            .setName("user")
            .setDescription("The user to whitelist.")
            .setRequired(true)
    )
    .addStringOption((option) =>
        option
            .setName("license")
            .setDescription("The type of license.")
            .setRequired(true)
            .addChoices(
                {
                    name: "Amateur Extra",
                    value: "extra",
                },
                {
                    name: "General",
                    value: "general",
                },
                {
                    name: "Technician",
                    value: "technician",
                }
            )
    )
    .addStringOption((option) =>
        option
            .setName("callsign")
            .setDescription("The callsign of the licensee.")
            .setRequired(true)
    );

const delUserCommand = new SlashCommandBuilder()
    .setName("deluser")
    .setDescription("Remove a user from the whitelist.")
    .addStringOption((option) =>
        option
            .setName("user")
            .setDescription("The ID of the user to be removed.")
            .setRequired(true)
    );

const requestKeyCommand = new SlashCommandBuilder()
    .setName("requestkey")
    .setDescription("Request a key to the remote station.");

const shutdownCommand = new SlashCommandBuilder()
    .setName("shutdown")
    .setDescription("Shut down the server.");

discordClient.on("interactionCreate", async (interaction) => {
    try {
        // return if not command
        if (!interaction.isCommand()) return;

        // defer the reply so discord doesn't time out on us
        await interaction.deferReply({ ephemeral: true });

        // get the command name
        const command = interaction.commandName;

        // add user command
        if (command === "adduser") {
            // return if the user isn't an admin
            if (!config.admins.includes(interaction.user.id)) {
                await interaction.editReply({
                    content: "You are not authorized to run this command!",
                });
                return;
            }

            // get the user to be added :3
            const toAdd = interaction.options.getUser("user").id;

            // return if the user to be added is already in the db
            if (
                db.data.users.filter((user) => user.id === toAdd).length !== 0
            ) {
                await interaction.editReply({
                    content: "This user is already in the whitelist!",
                });
                return;
            }

            await db.update(({ users }) =>
                users.push({
                    id: toAdd,
                    callsign: interaction.options.getString("callsign"),
                    license: interaction.options.getString("license"),
                    logbook: [],
                })
            );

            await interaction.editReply({
                content: "This user has been added to the whitelist.",
            });
        }
        // del user command
        else if (command === "deluser") {
            // return if the user isn't an admin
            if (!config.admins.includes(interaction.user.id)) {
                await interaction.editReply({
                    content: "You are not authorized to run this command!",
                });
                return;
            }

            // get the id of the user to be deleted
            const toDelete = db.data.users.find(
                (user) => user.id === interaction.options.getString("user")
            );

            if (!toDelete) {
                await interaction.editReply({
                    content: "User is not in the database.",
                });
                return;
            }

            await db.update(({ users }) =>
                users.splice(users.indexOf(toDelete), 1)
            );

            await interaction.editReply({
                content: "User has been deleted from the whitelist.",
            });
        }
        // request key command
        else if (command === "requestkey") {
            // get the user requesting the thingy
            const user = db.data.users.find(
                (user) => user.id === interaction.user.id
            );

            // return if user isn't in the db
            if (!user) {
                await interaction.editReply({
                    content: "You are not in the whitelist.",
                });
                return;
            }

            const message = await createCleartextMessage({
                text: JSON.stringify({
                    callsign: user.callsign,
                    license: user.license,
                    id: user.id,
                    url: state.url,
                    expiration: Date.now() + config.keyExpiry * 1000,
                }),
            });

            const signed = await sign({
                message,
                signingKeys: privateKey,
            });

            await interaction.editReply({
                content: "Below is your key.",
                files: [
                    new AttachmentBuilder(Buffer.from(signed)).setName(
                        `${user.callsign}-${Date.now()}.txt`
                    ),
                ],
            });
        }
        // shutdown command
        else if (command === "shutdown") {
            // return if the user isn't an admin
            if (!config.admins.includes(interaction.user.id)) {
                await interaction.editReply({
                    content: "You are not authorized to run this command!",
                });
                return;
            }

            await interaction.editReply({
                content: "Shutting down."
            });

            shutdown();
        }
    } catch (e) {
        console.log(e);
    }
});

const rest = new REST().setToken(config.discordToken);

await rest.put(
    Routes.applicationGuildCommands(config.applicationId, config.guildId),
    {
        body: [
            addUserCommand,
            delUserCommand,
            requestKeyCommand,
            shutdownCommand,
        ],
    }
);

await discordClient.login(config.discordToken);

// socket.io server
const io = new Server(config.port);



// connect ngrok!
state.url = (
    await ngrok.connect({
        authtoken: config.ngrokToken,
        proto: "tcp",
        addr: config.port,
        onStatusChange: (status) => {
            if (status !== "connected") {
                console.log("Fuck");
            }
        },
    })
).replace("tcp://", "");

console.log("remoteham is now up.");
