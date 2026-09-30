/**
@type {import('xo').FlatXoConfig}
*/
const xoConfig = [
    {
        // Use Prettier for formatting; XO turns off its conflicting style rules.
        prettier: true,
        space: 4,
    },
    {
        ignores: ['dist/**'],
    },
];

export default xoConfig;
