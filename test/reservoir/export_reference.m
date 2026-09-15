function export_reference(reservoirDir, xmlDir, outDir)
%EXPORT_REFERENCE  Reference values for analysis/, from bpp_Res2.m itself.
%
%   export_reference(reservoirDir, xmlDir, outDir)
%
%   Runs bpp_Res2.m, from a checkout of BPplus-Reservoir at reservoirDir, over
%   every .xml file in xmlDir, and writes outDir/<name>.json with the 89
%   resdata.xls values for each, in the form test/check-reservoir.mjs reads.
%
%   The script runs as it ships, except for two lines that draw labels on the
%   SEVR figure, neither of which touches a result. Each is printed when it is
%   rewritten:
%
%   - The "T1" label indexes the aortic beat with a value that is not always an
%     integer in floating point, which stops the script on some recordings on
%     every release. The index is rounded.
%   - On releases before R2021a, the "SPTI" label passes
%     HorizontalAlignment='center', a name=value form those releases cannot
%     parse, and a file that does not parse does not run at all. It becomes
%     'HorizontalAlignment','center'.
%
%   bpp_Res2.m reads bppconfig.json from the folder it runs in, and MATLAB's
%   run() switches to the script's own folder. So the script is copied into a
%   temporary folder with its own bppconfig.json, and neither the checkout, its
%   bppconfig.json, nor xmlDir is read or changed beyond the .xml files.
%
%   From the bpconnect folder, in R2019b or later:
%
%     matlab -batch "addpath('test/reservoir'); export_reference('D:\Uscom\github\BPplus-Reservoir', 'C:\temp\xml', 'test/reservoir/reference')"
%
%   Needs the Signal Processing Toolbox (findpeaks, sgolay).

    reservoirDir = char(reservoirDir);
    xmlDir = char(xmlDir);
    outDir = char(outDir);

    source = fullfile(reservoirDir, 'bpp_Res2.m');
    if ~exist(source, 'file')
        error('export_reference:NoScript', 'No bpp_Res2.m in %s.', reservoirDir);
    end
    if isempty(dir(fullfile(xmlDir, '*.xml')))
        error('export_reference:NoFiles', 'No .xml files in %s.', xmlDir);
    end

    % outDir is usually relative to where this was started.
    here = pwd;
    if ~isAbsolute(outDir)
        outDir = fullfile(here, outDir);
    end

    work = tempname;
    dataDir = fullfile(work, 'data');
    mkdir(dataDir);
    copyfile(fullfile(xmlDir, '*.xml'), dataDir);

    writeBytes(fullfile(work, 'bppconfig.json'), ...
        unicode2native(jsonencode(struct('folder_name', [dataDir filesep])), 'UTF-8'));

    script = readBytes(source);

    % The "T1" label on the SEVR figure is placed at ao.p_av(ao_Ti*samplerate).
    % ao_Ti is ti/samplerate, and ti/samplerate*samplerate is not always an
    % integer in floating point, so on some recordings the script stops there
    % on every release. Rounding it, as the script already does for the same
    % index where it computes ao_p1, moves no result.
    script = rewrite(script, 'ao.p_av(ao_Ti*samplerate)', 'ao.p_av(round(ao_Ti*samplerate))');

    if releaseBefore2021a()
        script = rewrite(script, 'HorizontalAlignment=''center''', '''HorizontalAlignment'',''center''');
    end
    writeBytes(fullfile(work, 'bpp_Res2.m'), script);

    % The helpers it calls (read_BPplus, kreservoir_v15, ...) come from the checkout.
    addpath(reservoirDir);
    cleanup = onCleanup(@() leave(here, work, reservoirDir));

    cd(work);
    runScript(fullfile(work, 'bpp_Res2.m'));
    cd(here);

    xls = fullfile(dataDir, 'results', 'resdata.xls');
    if ~exist(xls, 'file')
        error('export_reference:NoResults', 'bpp_Res2.m did not write %s.', xls);
    end

    opts = detectImportOptions(xls);
    textColumns = {'re_file', 're_date', 're_bppvers', 're_bppalgo', 're_resvers', ...
                   're_kres', 're_quality', 're_aitype'};
    opts = setvartype(opts, intersect(textColumns, opts.VariableNames), 'string');
    results = readtable(xls, opts);

    if ~exist(outDir, 'dir')
        mkdir(outDir);
    end

    for row = 1:height(results)
        values = table2struct(results(row, :));
        names = fieldnames(values);
        for k = 1:numel(names)
            v = values.(names{k});
            if isstring(v) && ismissing(v)
                values.(names{k}) = NaN;     % null in JSON, as a missing number is
            end
        end

        [~, stem] = fileparts(char(results.re_file(row)));
        doc = struct( ...
            'source', sprintf('MATLAB bpp_Res2 %s (%s)', char(results.re_resvers(row)), version), ...
            'tolerance', 1e-6, ...
            'values', values);

        writeBytes(fullfile(outDir, [stem '.json']), unicode2native(prettyJson(doc), 'UTF-8'));
        fprintf('wrote %s.json\n', stem);
    end

    clear cleanup
end

function script = rewrite(script, from, to)
    % Reported, so the output says exactly how the script that ran differs from
    % the one in the checkout. A line already fixed upstream is left alone.
    count = numel(strfind(script, from));
    if count > 0
        script = strrep(script, from, to);
        fprintf('bpp_Res2.m: rewrote %d x  %s  as  %s\n', count, from, to);
    end
end

function runScript(file)
    % A function of its own, so the script's variables — it has a `data`, a
    % `row` and more — live here and cannot overwrite the caller's.
    run(file);
end

function leave(here, work, reservoirDir)
    % Out of the temporary folder before deleting it; Windows will not remove
    % the current folder.
    cd(here);
    rmpath(reservoirDir);
    if exist(work, 'dir')
        rmdir(work, 's');
    end
end

function old = releaseBefore2021a()
    if exist('isMATLABReleaseOlderThan', 'file')       % R2020b and later
        old = isMATLABReleaseOlderThan('R2021a');
    else
        old = true;                                     % R2020a or earlier
    end
end

function text = prettyJson(value)
    try
        text = jsonencode(value, 'PrettyPrint', true);  % R2021a and later
    catch
        text = jsonencode(value);
    end
end

function absolute = isAbsolute(p)
    absolute = ~isempty(regexp(p, '^([A-Za-z]:[\\/]|[\\/])', 'once'));
end

function text = readBytes(file)
    % Bytes, not text: the script's comments are not ASCII, and a decode and
    % re-encode in a different default encoding would change them.
    fid = fopen(file, 'r');
    if fid < 0
        error('export_reference:Read', 'Cannot read %s.', file);
    end
    text = char(fread(fid, Inf, '*uint8')');
    fclose(fid);
end

function writeBytes(file, bytes)
    fid = fopen(file, 'w');
    if fid < 0
        error('export_reference:Write', 'Cannot write %s.', file);
    end
    fwrite(fid, uint8(bytes));
    fclose(fid);
end
