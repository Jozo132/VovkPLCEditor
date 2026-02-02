import { PLC_Project } from "../utils/types.js"

/** @type { PLC_Project } */
export const plc_project = {
    offsets: {
        system: { offset: 0, size: 64 },
        input: { offset: 64, size: 64 },
        output: { offset: 128, size: 64 },
        marker: { offset: 192, size: 256 },
        timer: { offset: 0, size: 0 },
        counter: { offset: 0, size: 0 },
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
        '/programs/test/b',
        '/programs/test/a',
        '/programs/test/c',
    ],
    files: [
        {
            path: '/',
            type: 'program',
            name: 'main',
            full_path: '/main',
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
                }, {
                    type: 'asm',
                    name: 'Test 3',
                    comment: 'PLC Assembly',
                    code: `// This is a comment
// This is also a comment

/* 
    This is the same program written in JavaScript:
    let sum = 0;
    for (let i = 0; i < 10; i++) {
        sum += 10;
    }
    return sum;
*/

//############### Define constant values
const   sum = 0     // set "sum" to memory index 0
const   index = 1   // set "i"   to memory index 1
const   incr = 10

//############### Set initial values
ptr.const  sum
u8.const  0
u8.move
ptr.const  index // set u8 at address 1 to value 0
u8.const  0
u8.move

//############### Run test for loop
loop:
    //############### jump to end if "i" >= 10
    ptr.const  index
    u8.load
    u8.const   10
    u8.cmp_lt
    jmp_if_not end 
    jmp end

    //############### sum += 10
    ptr.const  sum
    ptr.copy
    u8.load
    u8.const   incr 
    u8.add
    u8.move

    //############### i++
    ptr.const  index
    ptr.copy
    u8.load
    u8.const   1
    u8.add
    u8.move

    jmp loop 

//############### exit the program and return the remaining stack
end:  
    ptr.const sum
    u8.load
// Should return 100 (0x64 in hex) 

// Test type conversion and overflow handling
u8.const 130
cvt u8 i8
cvt i8 f32
cvt f32 u8 

// Test bit operations
u8.const 0
u8.set 0
u8.set 1
u8.set 2
u8.set 3
u8.set 4
u8.set 5
u8.set 6
u8.set 7


u8.const 255
u8.get 7

// Expected leftover stack after test: [64 82 FF 01]

//########## Run recursive function test with a parameter (count down from 5)

u8.const 5
call FunctionTest
u8.drop

// Simple PLC logic test
    u8.readBit 10.0
    // u8.not
    u8.writeBit 20.0

// Previous way of doing the same task
    ptr.const 20
    ptr.copy
    u8.load
    ptr.const 10
    u8.load
    u8.get 0
    // u8.not

    jump_if_not RESET
    u8.set 0
    jump END

    RESET:
    u8.rset 0

    END:
    u8.move
exit


FunctionTest:
        // At the top of the stack should be the input value
        
        // Make a copy to check the if statement for 0
        u8.copy 
        u8.const 0
        u8.cmp_eq
        ret_if
        u8.const 1
        u8.sub
        call FunctionTest
        ret


`
                }
            ] // blocks
        }, {
            path: '/programs/some more programs',
            type: 'program',
            name: 'test',
            full_path: '/programs/some more programs/test',
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
