	'
	' Bouncing happy face (demo for CVBasic)
	'
	' by Oscar Toledo G.
	' https://nanochess.org/
	'
	' Creation date: Feb/28/2024.
	' Revision date: Aug/23/2025. Adapted for NES.
	'

	PALETTE $13, $38	' Yellow face

	PRINT AT 68,"Happy face!"

	x = 50
	y = 100
	dx = 1
	dy = 1

game_loop:
	WAIT
	WAIT
	SPRITE 0,y-1,x,1,0
	SPRITE 1,y-1,x + 8,3,0

	x = x + dx
	IF x = 0 THEN dx = -dx
	IF x = 240 THEN dx = -dx
	y = y + dy
	IF y = 0 THEN dy = -dy
	IF y = 176 THEN dy = -dy
	GOTO game_loop

	CHRROM 0

	CHRROM PATTERN 256

	BITMAP "......3333......"
	BITMAP "....33333333...."
	BITMAP "...3333333333..."
	BITMAP "..333333333333.."
	BITMAP ".33333333333333."
	BITMAP ".33333333333333."
	BITMAP "3333..3333..3333"
	BITMAP "3333..3333..3333"
	BITMAP "3333333333333333"
	BITMAP "3333333333333333"
	BITMAP ".33333333333333."
	BITMAP ".333..3333..333."
	BITMAP "..333......333.."
	BITMAP "...333....333..."
	BITMAP "....33333333...."
	BITMAP "......3333......"
