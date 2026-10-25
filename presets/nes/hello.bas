	'
	' CVBasic hello world (NES/Famicom).
	'
	' CVBasic is a BASIC compiler that targets many retro consoles.
	' On the NES the font lives in CHR ROM, so CHRROM is declared at the
	' end; PALETTE sets the colors (the default palette is all black).
	'

	PALETTE $13, $38			' yellow, light gray

	PRINT AT 33,"HELLO FROM CVBASIC!"
	PRINT AT 65,"NES TEXT VIA CHRROM"

	WHILE 1
		WAIT
	WEND

	CHRROM 0				' include the built-in font
