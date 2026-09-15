function export_reference(reservoirDir, xmlDir, outDir)
%EXPORT_REFERENCE  Reference values for analysis/, from bpp_Res2.m itself.
%
%   export_reference(reservoirDir, xmlDir, outDir)
%
%   Runs bpp_Res2.m UNMODIFIED, from a checkout of BPplus-Reservoir at
%   reservoirDir, over every .xml file in xmlDir, and writes outDir/<name>.json
%   with the 89 resdata.xls values for each, in the form
%   test/check-reservoir.mjs reads.
%
%   The script is run as it ships: it reads bppconfig.json from the current
%   folder and writes figures\ and results\ next to the data, so both happen in
%   a temporary folder and xmlDir is left untouched.
%
%   From the bpconnect folder:
%
%     matlab -batch "addpath('test/reservoir'); export_reference('D:\Uscom\github\BPplus-Reservoir', 'C:\temp\xml', 'test/reservoir/reference')"
%
%   Needs the Signal Processing Toolbox (findpeaks, sgolay).

    work = tempname;
    data = fullfile(work, 'data');
    mkdir(data);
    cleanup = onCleanup(@() rmdir(work, 's'));

    copyfile(fullfile(xmlDir, '*.xml'), data);

    config = fullfile(work, 'bppconfig.json');
    fid = fopen(config, 'w');
    fwrite(fid, jsonencode(struct('folder_name', [data filesep])));
    fclose(fid);

    here = pwd;
    restore = onCleanup(@() cd(here));
    addpath(reservoirDir);
    cd(work);

    % The script, exactly as it ships. It works in this function's workspace.
    run(fullfile(reservoirDir, 'bpp_Res2.m'));
    cd(here);

    xls = fullfile(data, 'results', 'resdata.xls');
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
                values.(names{k}) = [];
            end
        end

        [~, stem] = fileparts(char(results.re_file(row)));
        doc = struct( ...
            'source', sprintf('MATLAB bpp_Res2 %s (%s)', char(results.re_resvers(row)), version), ...
            'tolerance', 1e-6, ...
            'values', values);

        fid = fopen(fullfile(outDir, [stem '.json']), 'w');
        fwrite(fid, jsonencode(doc, 'PrettyPrint', true));
        fclose(fid);
        fprintf('wrote %s.json\n', stem);
    end
end
