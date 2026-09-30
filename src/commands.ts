import {SlashCommandBuilder} from '@discordjs/builders';

/**
`/adduser`: add a user to the whitelist (admin only).
*/
const userAddCommand = new SlashCommandBuilder()
    .setName('adduser')
    .setDescription('Add a user to the whitelist.')
    .addUserOption((option) =>
        option
            .setName('user')
            .setDescription('The user to whitelist.')
            .setRequired(true),
    )
    .addStringOption((option) =>
        option
            .setName('license')
            .setDescription('The type of license.')
            .setRequired(true)
            .addChoices(
                {name: 'Amateur Extra', value: 'extra'},
                {name: 'General', value: 'general'},
                {name: 'Technician', value: 'technician'},
            ),
    )
    .addStringOption((option) =>
        option
            .setName('callsign')
            .setDescription('The callsign of the licensee.')
            .setRequired(true),
    );

/**
`/deluser`: remove a user from the whitelist (admin only).
*/
const userDeleteCommand = new SlashCommandBuilder()
    .setName('deluser')
    .setDescription('Remove a user from the whitelist.')
    .addStringOption((option) =>
        option
            .setName('user')
            .setDescription('The ID of the user to be removed.')
            .setRequired(true),
    );

/**
`/requestkey`: get a signed, time-limited key for the station.
*/
const requestKeyCommand = new SlashCommandBuilder()
    .setName('requestkey')
    .setDescription('Request a key to the remote station.');

/**
`/shutdown`: shut the server down (admin only).
*/
const shutdownCommand = new SlashCommandBuilder()
    .setName('shutdown')
    .setDescription('Shut down the server.');

/**
`/inuse`: report who, if anyone, is using the station.
*/
const inUseCommand = new SlashCommandBuilder()
    .setName('inuse')
    .setDescription(
        'Returns information on whether the station is in use or not.',
    );

/**
All slash commands, ready to be registered with Discord.
*/
export const commands = [
    userAddCommand,
    userDeleteCommand,
    requestKeyCommand,
    shutdownCommand,
    inUseCommand,
].map((command) => command.toJSON());
