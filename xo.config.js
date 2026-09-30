/**
@type {import('xo').FlatXoConfig}
*/
const xoConfig = [
    {
        // XO only lints; formatting is left entirely to Prettier (see .prettierrc).
        prettier: "compat",
        space: 4,
    },
    {
        ignores: ["dist/**"],
    },
];

export default xoConfig;
