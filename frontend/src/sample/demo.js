// @ts-check
"use strict"

import { PLC_Project } from "../utils/types.js"

/** @type { PLC_Project } */
export const plc_project = {
    offsets: {
        control: { offset: 0, size: 16 },
        input: { offset: 16, size: 16 },
        output: { offset: 32, size: 16 },
        memory: { offset: 48, size: 16 },
        system: { offset: 64, size: 16 },
    },
    symbols: [
        { name: 'button1', location: 'input', type: 'bit', address: 0.0, initial_value: 0, comment: 'Test input' },
        { name: 'button2', location: 'input', type: 'bit', address: 0.1, initial_value: 0, comment: 'Test input' },
        { name: 'button3', location: 'input', type: 'bit', address: 0.2, initial_value: 0, comment: 'Test input' },
        { name: 'button4', location: 'input', type: 'bit', address: 0.3, initial_value: 0, comment: 'Test input' },
        { name: 'light1', location: 'output', type: 'bit', address: 0.0, initial_value: 0, comment: 'Test output' },
        { name: 'light2', location: 'output', type: 'bit', address: 0.1, initial_value: 0, comment: 'Test output' },
    ],
    folders: [
        '/test/b',
        '/test/a',
        '/test/c',
    ],
    files: [
        {
            path: '/',
            type: 'program',
            name: 'main',
            comment: 'This is the main program',
            blocks: [
                {
                    type: 'ladder',
                    name: 'Test 1',
                    comment: 'Trying to get this to work',
                    // Test
                    blocks: [
                        { id: `0`, x: 0, y: 0, type: 'contact', inverted: false, trigger: 'normal', symbol: 'S_1s' },
                        { id: `3`, x: 0, y: 1, type: 'contact', inverted: false, trigger: 'normal', symbol: 'button2' },
                        { id: `4`, x: 1, y: 0, type: 'contact', inverted: false, trigger: 'normal', symbol: 'button3' },
                        { id: `5`, x: 0, y: 2, type: 'contact', inverted: false, trigger: 'normal', symbol: 'light1' },
                        { id: `6`, x: 2, y: 0, type: 'contact', inverted: true, trigger: 'normal', symbol: 'button4' },
                        { id: `1`, x: 4, y: 0, type: 'coil', inverted: false, trigger: 'normal', symbol: 'light1' },
                        { id: `2`, x: 4, y: 1, type: 'coil_set', inverted: false, trigger: 'normal', symbol: 'light2' },


                        { id: `989`, x: 1, y: 5, type: 'contact', inverted: false, trigger: 'normal', symbol: 'button1' },
                        { id: `990`, x: 3, y: 5, type: 'contact', inverted: false, trigger: 'normal', symbol: 'button1' },
                        { id: `991`, x: 4, y: 5, type: 'coil', inverted: false, trigger: 'normal', symbol: 'button1' },
                        { id: `992`, x: 3, y: 6, type: 'coil', inverted: false, trigger: 'normal', symbol: 'button1' },
                        { id: `993`, x: 4, y: 6, type: 'contact', inverted: false, trigger: 'normal', symbol: 'button1' },
                        { id: `994`, x: 1, y: 6, type: 'coil', inverted: false, trigger: 'normal', symbol: 'button212' },
                    ],
                    connections: [
                        { from: { id: `0` }, to: { id: `4` } },
                        { from: { id: `3` }, to: { id: `4` } },
                        { from: { id: `4` }, to: { id: `6` } },
                        { from: { id: `6` }, to: { id: `2` } },
                        { from: { id: `5` }, to: { id: `6` } },
                        { from: { id: `6` }, to: { id: `1` } },

                        { from: { id: `990` }, to: { id: `991` } },
                        { from: { id: `992` }, to: { id: `993` } },
                    ]
                }, {
                    type: 'ladder',
                    name: 'Test 2',
                    comment: '',
                    // Toggle switch
                    blocks: [
                        { id: `0`, x: 0, y: 0, type: 'contact', inverted: false, trigger: 'rising', symbol: 'button1' },
                        { id: `1`, x: 1, y: 0, type: 'contact', inverted: true, trigger: 'normal', symbol: 'light1' },
                        { id: `2`, x: 2, y: 0, type: 'coil_set', inverted: false, trigger: 'normal', symbol: 'light1' },
                        { id: `3`, x: 1, y: 1, type: 'contact', inverted: false, trigger: 'normal', symbol: 'light1' },
                        { id: `4`, x: 2, y: 1, type: 'coil_rset', inverted: false, trigger: 'normal', symbol: 'light1' },
                    ],
                    connections: [
                        { id: `1`, from: { id: `0` }, to: { id: `1` } },
                        { id: `2`, from: { id: `1` }, to: { id: `2` } },
                        { id: `3`, from: { id: `0` }, to: { id: `3` } },
                        { id: `4`, from: { id: `3` }, to: { id: `4` } },
                    ]
                }
            ] // blocks
        }, {
            path: '/programs/some more programs',
            type: 'program',
            name: 'test',
            comment: 'This is not the main program',
            blocks: [
                {
                    type: 'ladder',
                    name: 'Test 3',
                    comment: '',
                    // Toggle switch
                    blocks: [
                        { id: `0`, x: 0, y: 0, type: 'contact', inverted: false, trigger: 'rising', symbol: 'button1' },
                        { id: `1`, x: 1, y: 0, type: 'contact', inverted: true, trigger: 'normal', symbol: 'light1' },
                        { id: `2`, x: 2, y: 0, type: 'coil_set', inverted: false, trigger: 'normal', symbol: 'light1' },
                        { id: `3`, x: 1, y: 1, type: 'contact', inverted: false, trigger: 'normal', symbol: 'light1' },
                        { id: `4`, x: 2, y: 1, type: 'coil_rset', inverted: false, trigger: 'normal', symbol: 'light1' },
                    ],
                    connections: [
                        { id: `1`, from: { id: `0` }, to: { id: `1` } },
                        { id: `2`, from: { id: `1` }, to: { id: `2` } },
                        { id: `3`, from: { id: `0` }, to: { id: `3` } },
                        { id: `4`, from: { id: `3` }, to: { id: `4` } },
                    ]
                }, {
                    type: 'ladder',
                    name: 'Test 4',
                    comment: '',
                    // Test
                    blocks: [
                        { id: `0`, x: 0, y: 0, type: 'contact', inverted: false, trigger: 'normal', symbol: 'S_1s' },
                        { id: `3`, x: 0, y: 1, type: 'contact', inverted: false, trigger: 'normal', symbol: 'button2' },
                        { id: `4`, x: 1, y: 0, type: 'contact', inverted: false, trigger: 'normal', symbol: 'button3' },
                        { id: `5`, x: 0, y: 2, type: 'contact', inverted: false, trigger: 'normal', symbol: 'light1' },
                        { id: `6`, x: 2, y: 0, type: 'contact', inverted: true, trigger: 'normal', symbol: 'button4' },
                        { id: `1`, x: 4, y: 0, type: 'coil', inverted: false, trigger: 'normal', symbol: 'light1' },
                        { id: `2`, x: 4, y: 1, type: 'coil_set', inverted: false, trigger: 'normal', symbol: 'light2' },


                        { id: `989`, x: 1, y: 5, type: 'contact', inverted: false, trigger: 'normal', symbol: 'button1' },
                        { id: `990`, x: 3, y: 5, type: 'contact', inverted: false, trigger: 'normal', symbol: 'button1' },
                        { id: `991`, x: 4, y: 5, type: 'coil', inverted: false, trigger: 'normal', symbol: 'button1' },
                        { id: `992`, x: 3, y: 6, type: 'coil', inverted: false, trigger: 'normal', symbol: 'button1' },
                        { id: `993`, x: 4, y: 6, type: 'contact', inverted: false, trigger: 'normal', symbol: 'button1' },
                        { id: `994`, x: 1, y: 6, type: 'coil', inverted: false, trigger: 'normal', symbol: 'button1' },
                    ],
                    connections: [
                        { from: { id: `0` }, to: { id: `4` } },
                        { from: { id: `3` }, to: { id: `4` } },
                        { from: { id: `4` }, to: { id: `6` } },
                        { from: { id: `6` }, to: { id: `2` } },
                        { from: { id: `5` }, to: { id: `6` } },
                        { from: { id: `6` }, to: { id: `1` } },

                        { from: { id: `990` }, to: { id: `991` } },
                        { from: { id: `992` }, to: { id: `993` } },
                    ]
                },
            ] // blocks
        }
    ] // project
}
